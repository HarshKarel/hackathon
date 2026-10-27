import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createGemini, costUsd, responseText } from '../pipeline/lib/gemini.mjs';
import { logAiRun, runRequests } from '../pipeline/lib/aiflow.mjs';
import { collectPendingRewrites, rewriteMany, rewriteRequest } from '../pipeline/lib/rewrite.mjs';
import { backfillCandidates } from '../pipeline/backfill.mjs';
import { fakeGemini, promptOf, TEST_ENV } from './fake-gemini.mjs';
import { rec } from './helpers.mjs';

const req = (i) => ({ key: `k${i}`, request: { contents: [{ role: 'user', parts: [{ text: `item ${i}` }] }] } });
const echo = (request) => `echo: ${promptOf(request)}`;

test('model comes from LLM_MODEL only; key goes in the x-goog-api-key header, never the URL', async () => {
  const f = fakeGemini({ respond: echo, env: { ...TEST_ENV, LLM_MODEL: 'some-other-model' } });
  await f.ai.generate(req(1).request);
  const c = f.calls[0];
  assert.equal(c.url, 'https://generativelanguage.googleapis.com/v1beta/models/some-other-model:generateContent');
  assert.equal(c.method, 'POST');
  assert.equal(c.headers['x-goog-api-key'], TEST_ENV.LLM_API_KEY);
  assert.ok(!c.url.includes(TEST_ENV.LLM_API_KEY));
  assert.equal(createGemini({ LLM_API_KEY: 'k' }), null, 'no model, no client');
});

test('rewrite requests ask Gemini for JSON with low thinking and no request logging', () => {
  const r = rewriteRequest({ title: 'X' }, 'text');
  assert.equal(r.generationConfig.responseMimeType, 'application/json');
  assert.deepEqual(r.generationConfig.responseJsonSchema.required, ['summary', 'description']);
  assert.deepEqual(r.generationConfig.thinkingConfig, { thinkingLevel: 'LOW' });
  assert.equal(r.store, false);
  assert.ok(r.systemInstruction.parts[0].text.includes('Never use em dashes'));
  assert.ok(!('temperature' in r.generationConfig), 'temperature is ignored by Gemini 3.6 and later');
});

test('rate limits are retried; thought parts and bad finish reasons are handled', async () => {
  const f = fakeGemini({ respond: echo, failStandardTimes: 2 });
  const res = await f.ai.generate(req(1).request);
  assert.equal(f.calls.length, 3);
  assert.deepEqual(responseText(res), { text: 'echo: item 1' }, 'the thought part is skipped');
  assert.match(responseText({ candidates: [{ finishReason: 'MAX_TOKENS', content: { parts: [{ text: '{"a"' }] } }] }).error, /MAX_TOKENS/);
  assert.match(responseText({ promptFeedback: { blockReason: 'SAFETY' } }).error, /blocked \(SAFETY\)/);
  const bad = fakeGemini({ respond: echo, env: { ...TEST_ENV } });
  bad.ai.model; // same client, wrong key below
  const wrongKey = createGemini({ ...TEST_ENV, LLM_API_KEY: 'AIzaWrongKeyWrongKeyWrongKey00' }, { fetchImpl: bad.fetchImpl, sleep: async () => {} });
  await assert.rejects(wrongKey.generate(req(1).request), (err) => /403/.test(err.message) && !err.message.includes('AIzaWrongKey'));
  assert.equal(bad.calls.length, 1, 'a 403 is not retried');
});

test('10 or more items go to ONE batch job; results map back by key', async () => {
  const f = fakeGemini({ respond: echo, pollsBeforeDone: 2 });
  const logs = [];
  const res = await runRequests(f.ai, Array.from({ length: 10 }, (_, i) => req(i)), { label: 'test', log: (m) => logs.push(m), now: new Date('2026-10-27T10:00:00Z') });
  assert.equal(res.mode, 'batch');
  assert.equal(res.jobId, 'batches/fake1');
  const creates = f.calls.filter((c) => c.url.endsWith(':batchGenerateContent'));
  assert.equal(creates.length, 1);
  assert.equal(creates[0].url, 'https://generativelanguage.googleapis.com/v1beta/models/gemini-3.8-flash:batchGenerateContent');
  const body = creates[0].body;
  assert.match(body.batch.display_name, /^hackathon-so-test-2026-10-27-10-00$/);
  assert.equal(body.batch.input_config.requests.requests.length, 10);
  assert.deepEqual(body.batch.input_config.requests.requests[3].metadata, { key: 'k3' });
  assert.equal(f.calls.filter((c) => c.method === 'GET').length, 3, 'polled until done');
  assert.equal(f.calls.filter((c) => c.url.endsWith(':generateContent')).length, 0);
  assert.equal(res.results.get('k7').text, 'echo: item 7');
  assert.deepEqual(res.usage, { input: 10000, output: 2000, thoughts: 1000 });
  assert.ok(logs.some((l) => l.includes('batch job batches/fake1 submitted with 10 items')));
});

test('fewer than 10 items use standard requests on the same model', async () => {
  const f = fakeGemini({ respond: echo });
  const res = await runRequests(f.ai, Array.from({ length: 9 }, (_, i) => req(i)));
  assert.equal(res.mode, 'standard');
  assert.equal(res.jobId, null);
  assert.equal(f.calls.length, 9);
  assert.ok(f.calls.every((c) => c.url.endsWith('/models/gemini-3.8-flash:generateContent')));
});

test('batch states are read with either prefix; a failed job fails every item; a slow job is handed on', async () => {
  const jobState = fakeGemini({ respond: echo, finalState: 'JOB_STATE_SUCCEEDED' });
  assert.equal((await runRequests(jobState.ai, Array.from({ length: 10 }, (_, i) => req(i)))).results.get('k0').text, 'echo: item 0');
  const failed = fakeGemini({ respond: echo, finalState: 'BATCH_STATE_FAILED' });
  const r = await runRequests(failed.ai, Array.from({ length: 10 }, (_, i) => req(i)));
  assert.equal(r.state, 'FAILED');
  assert.match(r.results.get('k4').error, /batch job failed/);
  const slow = fakeGemini({ respond: echo, pollsBeforeDone: 99 });
  const s = await runRequests(slow.ai, Array.from({ length: 10 }, (_, i) => req(i)), { pollMs: 1000, maxWaitMs: 3000 });
  assert.equal(s.timedOut, true);
  assert.equal(s.results.size, 0);
});

test('cost estimate uses $0.75 in and $3.75 out per million tokens, thinking billed as output', () => {
  assert.equal(costUsd({ input: 1_000_000, output: 0, thoughts: 0 }), 0.75);
  assert.equal(costUsd({ input: 0, output: 500_000, thoughts: 500_000 }), 3.75);
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ai-run-'));
  const line = logAiRun({ kind: 'rewrite', rounds: [{ round: 1, items: 10, accepted: 8, rejected: 2, failed: 0, tokens: { input: 10000, output: 2000, thoughts: 1000 } }, { round: 2, items: 2, accepted: 2, rejected: 0, failed: 0, tokens: { input: 2000, output: 400, thoughts: 200 } }] }, path.join(dir, 'runs.jsonl'));
  assert.deepEqual([line.totals.items, line.totals.accepted, line.totals.rejected], [10, 10, 2]);
  assert.equal(line.totals.estimatedCostUsd, costUsd({ input: 12000, output: 2400, thoughts: 1200 }));
});

// Twelve events: round 1 is one batch job; the three rejected drafts are
// retried as standard requests (fewer than 10) with the reasons.
function events(n) {
  return Array.from({ length: n }, (_, i) => ({
    e: { ...rec({ platform: 'devpost', sourceId: String(i), title: `Testville Hacks ${i + 1}`, mode: 'online', startDate: '2026-11-20', endDate: '2026-11-22' }), slug: `testville-hacks-${i + 1}-2026` },
    sourceText: 'Join us for a weekend of building. Teams compete for a grand prize.',
  }));
}
const goodFor = (title) => JSON.stringify({
  summary: `An online hackathon, ${title}, from 20 to 22 November 2026.`,
  description: `${title} is an online hackathon that runs from 20 November 2026 to 22 November 2026. `
    + 'Participants form small teams, choose a problem and spend the event turning an idea into a working prototype. '
    + 'Mentors are usually available to help with technical questions, and finished projects are shown to judges at the end. '
    + 'The listing on Devpost has the full schedule, the rules and the registration form, and anyone planning to take part should read it carefully before signing up, '
    + 'because the details there are the ones that count for entry and for judging.',
});

test('rewrite flow: batch for round 1, standard retries, every draft through the validators', async () => {
  const list = events(12);
  const seen = new Map();
  const f = fakeGemini({
    respond: (request) => {
      const title = promptOf(request).match(/"title": "([^"]+)"/)[1];
      const n = (seen.get(title) || 0) + 1;
      seen.set(title, n);
      const num = Number(title.split(' ').pop());
      if (num <= 2 && n === 1) return goodFor(title).replace('is an online hackathon', '— an online hackathon'); // em dash, fixed on retry
      if (num === 3) return JSON.stringify({ summary: 'x', description: 'Teams compete for a grand prize.' }); // copied and too short, twice
      return goodFor(title);
    },
  });
  const { outcomes, rounds } = await rewriteMany(list, f.ai, { now: new Date('2026-10-27T10:00:00Z') });
  assert.equal(rounds[0].mode, 'batch');
  assert.equal(rounds[0].jobId, 'batches/fake1');
  assert.equal(rounds[0].items, 12);
  assert.deepEqual([rounds[0].accepted, rounds[0].rejected, rounds[0].failed], [9, 3, 0]);
  assert.equal(rounds[1].mode, 'standard');
  assert.deepEqual([rounds[1].items, rounds[1].accepted, rounds[1].rejected], [3, 2, 1]);
  assert.equal(outcomes.get(list[0].e.slug).descriptionStatus, 'ai');
  const flagged = outcomes.get(list[2].e.slug);
  assert.equal(flagged.descriptionStatus, 'review');
  assert.ok(flagged.problems.some((p) => /shares a full sentence/.test(p)));
  assert.ok(rounds[0].estimatedCostUsd > 0);
});

test('a batch job left running by an earlier run is collected, not paid for twice', async () => {
  const list = events(10);
  const store = new Map(list.map(({ e }) => [e.slug, { ...e, factsHash: 'h1' }]));
  const f = fakeGemini({ respond: (request) => goodFor(promptOf(request).match(/"title": "([^"]+)"/)[1]), pollsBeforeDone: 0 });
  const jobId = await f.ai.batchCreate(list.map(({ e }) => ({ key: e.slug, request: rewriteRequest({ title: e.title }, '') })), 'earlier');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pending-'));
  const file = path.join(dir, 'ai-pending.json');
  fs.writeFileSync(file, JSON.stringify({ jobs: [{ kind: 'rewrite', jobId, items: list.map(({ e }, i) => ({ slug: e.slug, factsHash: i === 0 ? 'stale' : 'h1' })) }] }));
  const got = await collectPendingRewrites(f.ai, store, { file });
  assert.equal(got.prefilled.size, 9, 'the event whose facts changed is rewritten afresh');
  assert.equal(fs.existsSync(file), false, 'collected jobs are removed');
  const calls = f.calls.length;
  const { outcomes, rounds } = await rewriteMany(list, f.ai, { prefilled: got.prefilled });
  assert.equal(rounds[0].collectedFromEarlierJob, 9);
  assert.equal(rounds[0].mode, 'standard', 'only the one stale event is sent');
  assert.equal(f.calls.length - calls, 1);
  assert.equal([...outcomes.values()].filter((o) => o.descriptionStatus === 'ai').length, 10);

  const running = fakeGemini({ respond: echo, pollsBeforeDone: 99 });
  const id2 = await running.ai.batchCreate([req(1)], 'running');
  fs.writeFileSync(file, JSON.stringify({ jobs: [{ kind: 'rewrite', jobId: id2, items: [{ slug: 'a', factsHash: 'h' }] }] }));
  const busy = await collectPendingRewrites(running.ai, new Map(), { file });
  assert.ok(busy.busy.has('a'));
  assert.ok(fs.existsSync(file), 'a running job stays recorded');
});

test('backfill queues exactly the events still showing a placeholder', () => {
  const m = new Map([
    ['a', { slug: 'a', descriptionStatus: 'placeholder' }],
    ['b', { slug: 'b', descriptionStatus: 'ai' }],
    ['c', { slug: 'c', descriptionStatus: 'review' }],
    ['d', { slug: 'd', descriptionStatus: 'placeholder' }],
  ]);
  assert.deepEqual(backfillCandidates(m).map((e) => e.slug), ['a', 'd']);
});
