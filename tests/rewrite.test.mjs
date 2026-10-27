import test from 'node:test';
import assert from 'node:assert/strict';
import { sharedSentences, factProblems, longestSharedRun } from '../pipeline/lib/copycheck.mjs';
import { checkRewrite, factsFor, factsHash, placeholderFor, rewriteEvent } from '../pipeline/lib/rewrite.mjs';
import { llmStatus, redact } from '../pipeline/lib/llm.mjs';
import { rec } from './helpers.mjs';

const SOURCE = 'Join the brightest builders in Lisbon for three days of shipping. Teams compete for a grand prize. Food and swag provided for everyone attending.';
const event = rec({
  platform: 'ethglobal', sourceId: '1', title: 'ETHGlobal Testville', organiser: 'ETHGlobal', mode: 'in-person', city: 'Lisbon', countryCode: 'PT',
  startDate: '2026-11-20T00:00:00.000Z', endDate: '2026-11-22T00:00:00.000Z', registrationDeadline: '2026-11-10T12:00:00.000Z', deadlineKind: 'registration',
});

const GOOD = {
  summary: 'An in-person Ethereum hackathon in Lisbon, Portugal, run by ETHGlobal from 20 to 22 November 2026.',
  description: 'ETHGlobal Testville brings developers together in Lisbon, Portugal, for an in-person hackathon organised by ETHGlobal. '
    + 'The event runs from 20 November 2026 to 22 November 2026, and registration closes on 10 November 2026. '
    + 'Participants form teams, pick a problem and spend the weekend turning an idea into a working prototype built on Ethereum tools. '
    + 'Mentors and partner teams are usually on hand to answer technical questions, and projects are presented to judges at the end. '
    + 'The listing on ETHGlobal holds the full schedule, the rules and the application form, so anyone planning to attend should read it carefully before the registration window closes.',
};

function fakeLlm(outputs) {
  let i = 0;
  return { stats: { calls: 0 }, async complete() { this.stats.calls += 1; const o = outputs[i++]; if (o instanceof Error) throw o; return typeof o === 'string' ? o : JSON.stringify(o); } };
}

test('copy check finds a shared full sentence', () => {
  assert.deepEqual(sharedSentences('Teams compete for a grand prize. Then more.', SOURCE), ['teams compete for a grand prize']);
  assert.deepEqual(sharedSentences(GOOD.description, SOURCE), []);
  assert.ok(longestSharedRun(GOOD.description, SOURCE).words < 5);
});

test('a title used as a heading in the source is not a copied sentence', () => {
  const src = 'Testville Hacks Autumn Edition 2026\nBuild things with friends over a weekend.';
  const out = 'Testville Hacks Autumn Edition 2026 is an online hackathon.';
  assert.equal(sharedSentences(out, src).length, 1, 'without the allow list it would be flagged');
  assert.deepEqual(sharedSentences(out, src, { allow: ['Testville Hacks Autumn Edition 2026'] }), []);
  assert.equal(sharedSentences('Build things with friends over a weekend.', src, { allow: ['Testville Hacks Autumn Edition 2026'] }).length, 1);
});

test('fragments of stated facts split at abbreviation periods are not copied sentences', () => {
  const org = 'Dr. Ambedkar Institute of Technology (Dr. AIT), Bangalore';
  const src = `About the organiser:\n${org}\nEstablished long ago.`;
  const out = `Colossus is an in-person hackathon, organised by ${org}. It runs for two days.`;
  assert.deepEqual(sharedSentences(out, src, { allow: [org] }), []);
  const title = 'P.A.C.E - Where Logic Meets Expression.';
  assert.deepEqual(sharedSentences(`${title} is an online hackathon.`, `Welcome to ${title} - by a club!`, { allow: [title] }), []);
});

test('fact check rejects numbers and months that are not in the facts', () => {
  const facts = factsFor(event);
  assert.deepEqual(factProblems(GOOD.description, facts), []);
  assert.match(factProblems('It runs from 25 November 2026.', facts)[0], /numbers not in the facts: 25/);
  assert.match(factProblems('It runs in December 2026.', facts)[0], /months not in the facts/);
  assert.match(factProblems('It starts on Friday.', facts)[0], /day of the week/);
});

test('good output is accepted first time', async () => {
  const llm = fakeLlm([GOOD]);
  const r = await rewriteEvent(event, SOURCE, llm);
  assert.equal(r.descriptionStatus, 'ai');
  assert.equal(r.attempts, 1);
});

test('copied sentence is retried once with reasons, then accepted', async () => {
  const bad = { ...GOOD, description: `${GOOD.description} Teams compete for a grand prize.` };
  const r = await rewriteEvent(event, SOURCE, fakeLlm([bad, GOOD]));
  assert.equal(r.descriptionStatus, 'ai');
  assert.equal(r.attempts, 2);
});

test('two failures flag the event for review', async () => {
  const dash = { ...GOOD, summary: 'Lisbon \u2014 Ethereum hackathon' };
  const r = await rewriteEvent(event, SOURCE, fakeLlm([dash, dash]));
  assert.equal(r.descriptionStatus, 'review');
  assert.equal(r.attempts, 2);
  assert.ok(r.problems.some((p) => /em dash/.test(p)));
});

test('API errors count as a failed attempt', async () => {
  const r = await rewriteEvent(event, SOURCE, fakeLlm([new Error('overloaded'), GOOD]));
  assert.equal(r.descriptionStatus, 'ai');
});

test('an outage with no draft at all is an error to retry, not a review case', async () => {
  const r = await rewriteEvent(event, SOURCE, fakeLlm([new Error('rate limited'), new Error('rate limited')]));
  assert.equal(r.descriptionStatus, 'error');
});

test('word count is enforced', () => {
  const p = checkRewrite({ summary: 'Short.', description: 'Too short.' }, SOURCE, factsFor(event));
  assert.ok(p.some((x) => /words/.test(x)));
});

test('placeholder uses only facts and has no em dash', () => {
  const p = placeholderFor(event);
  assert.ok(!/\u2014/.test(p.description + p.summary));
  assert.match(p.description, /ETHGlobal Testville is an in-person hackathon in Lisbon, Portugal, organised by ETHGlobal/);
  assert.match(p.description, /registration deadline is 10 November 2026/);
  assert.deepEqual(sharedSentences(p.description, SOURCE), []);
});

test('facts hash changes with facts and source text, not with niches', () => {
  const h = factsHash(event, SOURCE);
  assert.equal(factsHash({ ...event, niches: ['Open'] }, SOURCE), h);
  assert.notEqual(factsHash({ ...event, registrationDeadline: '2026-11-11T12:00:00.000Z' }, SOURCE), h);
  assert.notEqual(factsHash(event, SOURCE + ' New line.'), h);
});

test('AI is off without LLM_API_KEY or LLM_MODEL, and the key is redacted', () => {
  assert.equal(llmStatus({}).configured, false);
  assert.equal(llmStatus({ LLM_API_KEY: 'k' }).configured, false);
  assert.equal(llmStatus({ LLM_API_KEY: 'k', LLM_MODEL: 'm' }).configured, true);
  assert.equal(redact('bad key sk-ant-abcdefghijklmnop here', { LLM_API_KEY: 'sk-ant-abcdefghijklmnop' }), 'bad key [redacted] here');
});
