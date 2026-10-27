import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { NICHES } from '../pipeline/config.mjs';
import { duplicateOf, keywords, nicheCounts, thinnestTargets, validateIdea } from '../pipeline/lib/ideas.mjs';
import { checkGenerated, planSlots, runIdeas } from '../pipeline/ideas.mjs';
import { matchIdeas, rankIdeas } from '../src/_lib/ideas.js';
import { fakeGemini, promptOf } from './fake-gemini.mjs';

const seed = JSON.parse(fs.readFileSync(new URL('../data/ideas-seed.json', import.meta.url), 'utf8')).ideas;
const byId = Object.fromEntries(seed.map((c) => [c.id, c]));

test('seed: 30 valid cards, unique ids, at least 2 per niche, varied difficulty and team size', () => {
  assert.equal(seed.length, 30);
  assert.equal(new Set(seed.map((c) => c.id)).size, 30);
  for (const c of seed) assert.deepEqual(validateIdea(c), [], c.id);
  const primary = {};
  for (const c of seed) primary[c.niches[0]] = (primary[c.niches[0]] || 0) + 1;
  for (const n of NICHES) assert.ok((primary[n] || 0) >= 2, `${n} is the main niche of at least 2 cards`);
  for (const d of ['weekend-easy', 'weekend-medium', 'weekend-hard']) assert.ok(seed.filter((c) => c.difficulty === d).length >= 5, d);
  for (const t of ['solo-friendly', 'pair', 'team']) assert.ok(seed.some((c) => c.teamSize === t), t);
  assert.ok(seed.every((c) => c.source.kind === 'seed'));
});

test('seed: no card is a near-duplicate of another, and none is a vague platform pitch', () => {
  for (let i = 0; i < seed.length; i++) assert.equal(duplicateOf(seed[i], seed.slice(0, i)), null, seed[i].id);
  for (const c of seed) assert.ok(!/\b(an? )?(ai )?platform for\b/i.test(`${c.title} ${c.pitch}`), c.id);
  for (const c of seed) assert.match(c.whatItDoes, /In the demo,/, c.id);
});

test('validation catches em dashes, sentence count, length limits and unknown niches', () => {
  const good = byId['subscription-leak-finder'];
  const v = (over) => validateIdea({ ...good, ...over });
  assert.ok(v({ title: 'Subscription — Leak Finder' }).includes('contains an em dash'));
  assert.ok(v({ whatItDoes: 'One sentence about a demo only.' }).some((p) => /1 sentences/.test(p)));
  assert.ok(v({ pitch: `${good.pitch} ${good.pitch}` }).some((p) => /pitch is \d+ characters/.test(p)));
  assert.ok(v({ niches: ['Robots'] }).some((p) => /unknown niches: Robots/.test(p)));
  assert.ok(v({ niches: [] }).some((p) => /1 to 3 niches/.test(p)));
  assert.ok(v({ difficulty: 'easy' }).some((p) => /difficulty must be/.test(p)));
  assert.ok(v({ whatItDoes: good.whatItDoes.replace(/In the demo,[^.]*\./, 'Users like it a lot.') }).some((p) => /demo moment/.test(p)));
});

test('near-duplicate: shared title keywords plus a shared niche; a different niche is not a duplicate', () => {
  const card = { title: 'Fridge Photo Recipe Planner', pitch: 'Photograph a fridge and plan meals for the week ahead.', niches: ['AI and ML'] };
  const d = duplicateOf(card, seed);
  assert.equal(d.id, 'fridge-photo-meal-planner');
  assert.deepEqual(d.sharedTitleKeywords, ['fridge', 'photo', 'planner']);
  assert.equal(duplicateOf({ ...card, niches: ['Gaming'] }, seed), null);
  assert.deepEqual([...keywords('Visual Alerts for the Doorbell and Alarms')], ['visual', 'alert', 'doorbell', 'alarm']);
});

test('thinnest niches get the new cards, one at a time', () => {
  const t = thinnestTargets(seed, 10);
  const c = nicheCounts(seed);
  const min = Math.min(...Object.values(c));
  assert.equal(c[t[0]], min);
  assert.ok(t.includes('Web3') && t.includes('Gaming'));
  const slots = planSlots(seed, 10);
  assert.ok(new Set(slots.map((s) => s.difficulty)).size >= 2, 'difficulties vary across the batch');
});

// ---------- event matching ----------

const ev = (slug, niches, extra = {}) => ({ slug, niches, status: 'upcoming', startDate: '2026-11-01', endDate: '2026-11-02', ...extra });
const gen = (id, niches, date) => ({ id, title: id, pitch: id, niches, source: { kind: 'generated', date } });

test('idea starters: up to 3 cards sharing a niche, preferring cards not shown on series siblings', () => {
  const ideas = [...seed];
  const picks = rankIdeas(ev('a', ['Web3']), ideas);
  assert.ok(picks.length <= 3 && picks.every((i) => i.niches.includes('Web3')));
  const open = rankIdeas(ev('b', ['Health', 'AI and ML']), ideas);
  assert.equal(open.length, 3);
  assert.ok(open.every((i) => i.niches.includes('Health') || i.niches.includes('AI and ML')));
  // Two editions of one series with the same niche never repeat a card while
  // there are enough cards to go round.
  const s1 = ev('s-2025', ['AI and ML'], { seriesSlug: 's', startDate: '2025-11-01' });
  const s2 = ev('s-2026', ['AI and ML'], { seriesSlug: 's', startDate: '2026-11-01' });
  const m = matchIdeas([s2, s1], ideas);
  const first = m.get('s-2025').map((i) => i.id);
  const second = m.get('s-2026').map((i) => i.id);
  assert.equal(first.length, 3);
  assert.equal(second.length, 3);
  assert.equal(second.filter((id) => first.includes(id)).length, 0);
});

test('ended events keep their ideas: cards generated after an event ended never replace them', () => {
  const ended = ev('old', ['Gaming'], { status: 'ended', endDate: '2026-10-01' });
  const before = rankIdeas(ended, seed).map((i) => i.id);
  const later = [gen('zz-gaming-later', ['Gaming'], '2026-11-04'), gen('aa-gaming-later', ['Gaming'], '2026-11-04')];
  assert.deepEqual(rankIdeas(ended, [...seed, ...later]).map((i) => i.id), before);
  const upcoming = ev('new', ['Gaming']);
  assert.ok(rankIdeas(upcoming, [...seed, ...later]).some((i) => i.id.endsWith('later')), 'upcoming events do see new cards');
});

// ---------- generator ----------

const TITLES = [
  ['Harbour Tide Logger', 'Fishing crews log tide heights from a pier gauge and share alerts before low water.'],
  ['Choir Seating Planner', 'Choir directors drag singers into a seating chart that balances voices automatically.'],
  ['Pantry Barcode Ledger', 'Community pantries scan donated tins to see stock levels by shelf at any moment.'],
  ['Bike Shed Occupancy Light', 'A sensor on a bike shed shows riders a green light when racks are free.'],
  ['Quiz Night Buzzer Web', 'Pub quiz hosts run rounds while teams buzz in from phones with fair timing.'],
  ['Allotment Water Rota', 'Allotment members sign up for watering turns and swap them when travelling.'],
  ['Thrift Price Scanner', 'Charity shop volunteers price donated clothes from photos using recent resale prices.'],
  ['Studio Booking Board', 'Music students reserve practice studios by the hour and release unused bookings.'],
  ['Escape Room Hint Pager', 'Escape room staff send timed hints to a pager screen inside each room.'],
  ['Tram Stop Noise Map', 'Residents record street noise near tram stops and compare hours on a map.'],
  ['Chess Club Ladder', 'Chess clubs track challenge matches and ladder positions without spreadsheets.'],
  ['Ferry Queue Estimator', 'Ferry passengers see the expected boarding wait from camera counts at the ramp.'],
];
function cardFor(prompt, i) {
  const niche = prompt.match(/Required niche \(list it first\): (.+)/)[1].trim();
  const difficulty = prompt.match(/difficulty: (\S+)/)[1];
  const teamSize = prompt.match(/teamSize: (\S+)/)[1];
  const [title, pitch] = TITLES[i % TITLES.length];
  return {
    title, pitch,
    whatItDoes: `Built for ${title.toLowerCase()} users who keep everything on paper today and lose track every week. `
      + 'The tool records each entry with a timestamp, groups entries by person, and shows a short summary page that anyone in the group can open from a shared link. '
      + 'Reminders go out automatically when something needs attention. '
      + `In the demo, a volunteer adds a live entry and the summary updates on the projector straight away.`,
    niches: [niche], stack: ['Next.js', 'SQLite'], difficulty, teamSize,
  };
}

test('generator: one batch job, near-duplicates and em dashes rejected and regenerated, rejections logged, nothing published silently', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ideas-'));
  const paths = {
    ideasSeed: new URL('../data/ideas-seed.json', import.meta.url).pathname,
    ideasGenerated: path.join(dir, 'generated.json'),
    ideasRejected: path.join(dir, 'rejected.jsonl'),
    ideasRuns: path.join(dir, 'runs.jsonl'),
    ideasLatest: path.join(dir, 'latest.json'),
    aiRuns: path.join(dir, 'ai-runs.jsonl'),
    healthDir: dir,
  };
  let next = 0;
  const f = fakeGemini({
    respond: (request, key) => {
      const p = promptOf(request);
      const c = cardFor(p, next++);
      // Slot 1 (Web3) first answers with a copy of an existing Web3 card.
      if (key === 'slot-1-attempt-1') return JSON.stringify({ ...c, title: 'QR Check-in Attendance Badges', pitch: 'Attendees scan a QR code at the door to collect an attendance badge on a testnet.' });
      // Slot 2 (Gaming) always answers with an em dash, in the batch job
      // (keyed) and in the standard retries (no key; only slot 2 retries Gaming).
      if (key === 'slot-2-attempt-1' || (!key && /Required niche \(list it first\): Gaming/.test(p))) {
        return JSON.stringify({ ...c, pitch: `${c.pitch.slice(0, -1)} \u2014 fast.` });
      }
      return JSON.stringify(c);
    },
  });
  const sum = await runIdeas([], { ai: f.ai, now: new Date('2026-10-28T05:41:00Z'), paths });
  // Round 1: 10 cards in ONE batch job. Round 2+: fewer than 10, standard requests.
  assert.equal(sum.rounds[0].mode, 'batch');
  assert.equal(sum.rounds[0].items, 10);
  assert.equal(f.calls.filter((c) => c.url.endsWith(':batchGenerateContent')).length, 1);
  assert.ok(sum.rounds.slice(1).every((r) => r.mode === 'standard'));
  // The near-duplicate is rejected with its reason, then regenerated.
  const dup = sum.rejected.find((r) => r.slot === 1);
  assert.match(dup.problems.join(' '), /near-duplicate of "QR Check-in Attendance Tokens" \(qr-check-in-attendance-tokens\): same niche Web3, shared title keywords: qr, check, attendance/);
  assert.equal(dup.final, false);
  // The em dash card is rejected three times and never published.
  const gaming = sum.rejected.filter((r) => r.slot === 2);
  assert.equal(gaming.length, 3);
  assert.ok(gaming.every((r) => r.problems.includes('contains an em dash')));
  assert.equal(gaming[2].final, true);
  const published = JSON.parse(fs.readFileSync(paths.ideasGenerated, 'utf8')).ideas;
  assert.equal(published.length, 9);
  assert.ok(published.every((c) => c.source.kind === 'generated' && c.source.date === '2026-10-28' && validateIdea(c).length === 0));
  assert.ok(published.some((c) => c.source.batchJobId === 'batches/fake1'));
  assert.equal(fs.readFileSync(paths.ideasRejected, 'utf8').trim().split('\n').length, sum.rejected.length);
  assert.equal(JSON.parse(fs.readFileSync(paths.ideasLatest, 'utf8')).notFilled, 1);
});

test('checkGenerated enforces the slot: niche first, difficulty and team size as asked', () => {
  const card = { ...byId['bus-bunching-map'], id: undefined, source: undefined, title: 'Ferry Queue Estimator', pitch: 'Ferry passengers see the expected boarding wait from camera counts at the ramp.' };
  const { problems } = checkGenerated(card, { niche: 'Social Impact', difficulty: 'weekend-hard', teamSize: 'team' }, seed);
  assert.ok(problems.includes('the first niche must be Social Impact'));
  assert.ok(problems.includes('difficulty must be weekend-hard'));
  assert.ok(problems.includes('teamSize must be team'));
});
