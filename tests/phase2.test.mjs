import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import * as unstop from '../pipeline/adapters/unstop.mjs';
import * as kaggle from '../pipeline/adapters/kaggle.mjs';
import { normaliseListing } from '../pipeline/lib/record.mjs';
import { placeholderFor, factsHash } from '../pipeline/lib/rewrite.mjs';
import { fetchAll } from '../pipeline/run.mjs';
import { suggestGuideKeys } from '../src/_lib/suggest.js';
import { NOW } from './helpers.mjs';

const item = {
  id: 501, title: 'Testville CTF 2026', seo_url: 'https://unstop.com/hackathons/testville-ctf-2026-501', region: 'hybrid',
  end_date: '2026-11-20T18:00:00+05:30', organisation: { name: 'Testville College' },
  regnRequirements: { end_regn_dt: '2026-11-10T23:59:00+05:30', min_team_size: 2, max_team_size: 4 },
  address_with_country_logo: { city: 'Pune', country: { name: 'India' } },
  filters: [{ type: 'eligible', name: 'Engineering Students' }, { type: 'eligible', name: 'Undergraduate' }],
  prizes: [{ rank: 'Winner ', cash: 15000, currency: 'fa-rupee', currencyCode: null, others: 'Internship Opportunity' }, { rank: 'Runner Up', cash: 0, others: 'Goodies' }],
  details: '<p>Made-up description.</p>',
};

test('unstop: facts as stated, CTF typed as competition, browser UA on requests', async () => {
  const { record } = normaliseListing(unstop.toListing(item, { start_date: '2026-11-19T09:00:00+05:30' }), NOW);
  assert.equal(record.type, 'competition');
  assert.equal(record.mode, 'hybrid');
  assert.equal(record.startDate, '2026-11-19T03:30:00.000Z');
  assert.equal(record.registrationDeadline, '2026-11-10T18:29:00.000Z');
  assert.equal(record.prizeText, 'Winner: INR 15,000 + Internship Opportunity; Runner Up: Goodies');
  assert.equal(record.teamSizeText, '2 to 4 members');
  assert.equal(record.eligibility, 'students');
  assert.equal(record.country, 'India');
  assert.equal(normaliseListing(unstop.toListing({ ...item, title: 'Build Day', filters: [{ type: 'eligible', name: 'All' }] }, { start_date: '2026-11-19' }), NOW).record.eligibility, 'open');
  assert.throws(() => unstop.toListing(item, {}), /no start date/);
  const seen = [];
  const http = { getJson: async (url, opts) => { seen.push(opts?.headers?.['user-agent']); return url.includes('search-result') ? { data: { data: url.includes('open') ? [item] : [], last_page: 1 } } : { data: { competition: { start_date: '2026-11-19T09:00:00+05:30' } } }; } };
  const res = await unstop.default.fetch({ http, log: () => {} });
  assert.equal(res.listings.length, 1);
  assert.ok(seen.every((ua) => /Chrome\//.test(ua)), 'every Unstop request sends a browser user agent');
});

test('kaggle: skipped silently with one health line when credentials are missing', async () => {
  const sources = {};
  const health = { source: (p, d) => { sources[p] = d; } };
  const logs = [];
  const adapter = { platform: 'kaggle', fetch: (ctx) => kaggle.default.fetch({ ...ctx, env: {} }) };
  const out = await fetchAll([adapter], { now: NOW, log: (m) => logs.push(m) }, health);
  assert.equal(out.length, 0);
  assert.deepEqual({ ok: sources.kaggle.ok, skipped: sources.kaggle.skipped }, { ok: null, skipped: true });
  assert.match(sources.kaggle.reason, /KAGGLE_USERNAME and KAGGLE_KEY/);
  assert.deepEqual(logs, [], 'nothing printed');
});

test('kaggle: competitions typed as such, Basic auth, entry deadline as registration', async () => {
  const c = { id: 7, ref: 'https://www.kaggle.com/c/test-comp', title: 'Test Comp', organizationName: 'Kaggle', reward: '$25,000', enabledDate: '2026-10-01T00:00:00Z', deadline: '2027-01-15T23:59:00Z', newEntrantDeadline: '2027-01-08T23:59:00Z', maxTeamSize: 5, tags: [{ name: 'tabular' }] };
  const { record } = normaliseListing(kaggle.toListing(c), NOW);
  assert.equal(record.type, 'competition');
  assert.equal(record.applyUrl, 'https://www.kaggle.com/competitions/test-comp');
  assert.equal(record.deadlineKind, 'registration');
  assert.equal(record.prizeText, '$25,000');
  assert.ok(record.niches.includes('Data Science'));
  assert.equal(kaggle.slugFromRef('titanic'), 'titanic');
  let auth;
  const tutorial = { id: 8, ref: 'titanic', title: 'Titanic', category: 'Getting Started', deadline: '2030-01-01T00:00:00Z' };
  let noCache;
  const http = { getJson: async (url, opts) => { auth = opts.headers.authorization; noCache = opts.noCache; return url.includes('page=1') ? [c, tutorial] : []; } };
  const res = await kaggle.default.fetch({ http, env: { KAGGLE_USERNAME: 'u', KAGGLE_KEY: 'k' }, log: () => {} });
  assert.deepEqual(res.listings.map((l) => l.title), ['Test Comp'], 'Getting Started tutorials are skipped');
  assert.equal(noCache, true, 'authenticated responses are never written to the disk cache');
  assert.equal(auth, `Basic ${Buffer.from('u:k').toString('base64')}`);
});

test('competitions read as competitions; hackathon hashes unchanged by the type field', () => {
  const { record } = normaliseListing(kaggle.toListing({ id: 1, ref: 'x', title: 'X Comp', enabledDate: '2026-10-01', deadline: '2026-12-01' }), NOW);
  assert.match(placeholderFor(record).description, /is an online competition/);
  const h = normaliseListing({ platform: 'devpost', sourceId: '1', url: 'https://a.devpost.com/', title: 'A', startDate: '2026-11-01', mode: 'online' }, NOW).record;
  const withoutType = { ...h };
  delete withoutType.type;
  assert.equal(factsHash(h, ''), factsHash(withoutType, ''));
});

const base = { sources: [{ platform: 'devpost' }], applyPlatform: 'devpost' };
const at = new Date('2026-10-27T12:00:00Z');

test('suggested guides follow the rules', () => {
  assert.deepEqual(suggestGuideKeys({ ...base, status: 'ended' }, at), { block: 'Reflect', keys: ['after', 'judging'] });
  assert.deepEqual(suggestGuideKeys({ ...base, status: 'live', registrationDeadline: '2026-11-20' }, at), { block: 'Prepare', keys: ['demo', 'pitch'] });
  assert.deepEqual(suggestGuideKeys({ ...base, status: 'live', registrationDeadline: '2026-10-30T17:00:00Z' }, at).keys, ['devpost', 'demo', 'pitch']);
  assert.deepEqual(suggestGuideKeys({ status: 'upcoming', applyPlatform: 'devfolio', sources: [{ platform: 'devfolio' }], registrationDeadline: '2026-10-29T18:30:00Z', startDate: '2026-11-15' }, at).keys, ['devfolio', 'team', 'plan']);
  assert.deepEqual(suggestGuideKeys({ status: 'upcoming', applyPlatform: 'mlh', sources: [{ platform: 'mlh' }], registrationDeadline: '2026-10-29', startDate: '2026-11-15' }, at).keys, ['team', 'plan', 'problem']);
  assert.deepEqual(suggestGuideKeys({ status: 'upcoming', applyPlatform: 'mlh', sources: [{ platform: 'mlh' }], startDate: '2026-10-31' }, at).keys, ['plan', 'team', 'problem']);
  assert.deepEqual(suggestGuideKeys({ status: 'upcoming', applyPlatform: 'mlh', sources: [{ platform: 'mlh' }], startDate: '2026-12-31' }, at).keys, ['choose', 'problem', 'team']);
  for (const s of ['upcoming', 'live', 'ended']) {
    const n = suggestGuideKeys({ ...base, status: s, startDate: '2026-12-31', registrationDeadline: '2026-10-28' }, at).keys.length;
    assert.ok(n >= 2 && n <= 3);
  }
});

test('guides: ten drafts with the requested titles, files present, no em dashes', () => {
  const list = JSON.parse(fs.readFileSync(new URL('../src/_data/guidesList.json', import.meta.url), 'utf8'));
  assert.deepEqual(list.map((g) => g.title), [
    'How to choose the right hackathon', 'How to pick a problem statement', 'How to form a team that works', 'How to plan 48 hours',
    'How to build a demo that lands', 'How to pitch to judges', 'How judging usually works', 'How to apply on Devpost, step by step',
    'How to apply on Devfolio, step by step', 'What to do after a hackathon ends, win or lose',
  ]);
  for (const g of list) {
    assert.equal(g.draft, true, `${g.key} stays a draft until reviewed`);
    const body = fs.readFileSync(new URL(`../src/guides/${g.slug}.md`, import.meta.url), 'utf8');
    assert.match(body, new RegExp(`^---\\nkey: ${g.key}\\n---`));
    assert.ok(!body.includes('\u2014'), `${g.slug} has an em dash`);
    assert.ok(!(g.title + g.description).includes('\u2014'));
  }
});

test('unstop: the event ends when its last stated round ends', () => {
  const detail = {
    start_date: '2026-10-01T00:00:00+05:30',
    end_date: '2026-10-20T23:59:00+05:30',
    rounds: [{ details: [{ end_date: '2026-10-20T23:59:00+05:30' }] }, { details: [{ end_date: '2026-11-08T18:00:00+05:30' }, { end_date: null }] }],
  };
  assert.equal(unstop.latestEnd({ end_date: '2026-10-20T23:59:00+05:30' }, detail), '2026-11-08T18:00:00+05:30');
  assert.equal(unstop.latestEnd({ end_date: '2026-10-20T23:59:00+05:30' }, { rounds: [] }), '2026-10-20T23:59:00+05:30');
  assert.equal(unstop.latestEnd({}, {}), null);
});
