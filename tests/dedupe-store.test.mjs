import test from 'node:test';
import assert from 'node:assert/strict';
import { dedupe, mergeRecords, pass2Match } from '../pipeline/lib/dedupe.mjs';
import { integrate, makeSlug } from '../pipeline/lib/store.mjs';
import { NOW, item, rec } from './helpers.mjs';

const CUTOFF = new Date(NOW.getTime() - 60 * 86_400_000);
const emptyStore = () => ({ events: new Map(), redirects: {} });

test('pass 1: records sharing a source id merge', () => {
  const seed = item({ platform: 'seed', sourceId: 'space-2026', title: 'Space Hack 2026', extraSources: [{ platform: 'devpost', sourceId: '77', url: 'https://space.devpost.com/' }], lastCheckedAt: '2026-10-01T00:00:00Z' });
  const dp = item({ platform: 'devpost', sourceId: '77', title: 'Space Hackathon (Global)', startDate: '2026-12-01' });
  const { merged, merges } = dedupe([seed, dp]);
  assert.equal(merged.length, 1);
  assert.equal(merges[0].pass, 1);
  // Seed has top priority for facts; both sources are kept.
  assert.equal(merged[0].record.title, 'Space Hack 2026');
  assert.deepEqual(merged[0].record.sources.map((s) => `${s.platform}:${s.sourceId}`).sort(), ['devpost:77', 'seed:space-2026']);
});

test('pass 2: normalised title + organiser + start date', () => {
  const a = rec({ platform: 'devpost', sourceId: '10', title: 'HackRPI 2026', organiser: 'HackRPI', startDate: '2026-11-07' });
  const b = rec({ platform: 'mlh', sourceId: 'm1', title: 'HackRPI', startDate: '2026-11-07T14:00:00Z', mode: 'in-person', city: 'Troy', countryCode: 'US' });
  assert.equal(pass2Match(a, b), true, 'year ignored, missing organiser does not block');
  const c = rec({ platform: 'mlh', sourceId: 'm2', title: 'HackRPI', organiser: 'Someone Else', startDate: '2026-11-07' });
  assert.equal(pass2Match(a, c), false, 'different stated organisers never match');
  const d = rec({ platform: 'mlh', sourceId: 'm3', title: 'HackRPI', startDate: '2026-11-09' });
  assert.equal(pass2Match(a, d), false, 'start dates more than a day apart');
  const e1 = rec({ platform: 'hackclub', sourceId: 'h1', title: 'Code Day', startDate: '2026-11-07', mode: 'in-person', countryCode: 'US' });
  const e2 = rec({ platform: 'devpost', sourceId: 'd9', title: 'Code Day', startDate: '2026-11-07', mode: 'in-person', countryCode: 'GB' });
  assert.equal(pass2Match(e1, e2), false, 'different countries never match');
});

test('merge keeps every source and takes facts by source priority', () => {
  const dp = rec({ platform: 'devpost', sourceId: '10', title: 'HackRPI 2026', organiser: 'HackRPI', prizeText: '$5,000 in prizes', registrationDeadline: '2026-11-08', deadlineKind: 'submission' });
  const mlh = rec({ platform: 'mlh', sourceId: 'm1', title: 'HackRPI', startDate: '2026-11-07T14:00:00Z', mode: 'in-person', city: 'Troy', countryCode: 'US' });
  const m = mergeRecords([mlh, dp]);
  assert.equal(m.title, 'HackRPI 2026');
  assert.equal(m.applyPlatform, 'devpost');
  assert.equal(m.prizeText, '$5,000 in prizes');
  assert.equal(m.sources.length, 2);
});

test('store: stable slug across runs, even if the title changes upstream', () => {
  const store = emptyStore();
  const r1 = integrate(store, [item({ sourceId: '42', title: 'Hack the Harbour' })], { now: NOW, endedCutoff: CUTOFF });
  const slug = r1.added[0];
  assert.equal(slug, 'hack-the-harbour-2026');
  const r2 = integrate(store, [item({ sourceId: '42', title: 'Hack the Harbour (renamed)', prizeText: '$1,000 in prizes' })], { now: NOW, endedCutoff: CUTOFF });
  assert.deepEqual(r2.updated, [{ slug, matchedBy: 1 }]);
  assert.equal(store.events.get(slug).title, 'Hack the Harbour (renamed)');
  assert.equal(store.events.size, 1);
});

test('store: events missing from a later run are kept (pages live forever)', () => {
  const store = emptyStore();
  integrate(store, [item({ sourceId: '1', title: 'One' }), item({ sourceId: '2', title: 'Two' })], { now: NOW, endedCutoff: CUTOFF });
  integrate(store, [item({ sourceId: '1', title: 'One' })], { now: NOW, endedCutoff: CUTOFF });
  assert.equal(store.events.size, 2);
});

test('store: a fresh null never erases a stored fact', () => {
  const store = emptyStore();
  integrate(store, [item({ sourceId: '5', title: 'Five', eligibilityText: 'Students only' })], { now: NOW, endedCutoff: CUTOFF });
  integrate(store, [item({ sourceId: '5', title: 'Five' })], { now: NOW, endedCutoff: CUTOFF });
  assert.equal([...store.events.values()][0].eligibilityText, 'Students only');
});

test('store: two pages later found to be one event become a redirect', () => {
  const store = emptyStore();
  integrate(store, [item({ platform: 'devpost', sourceId: '7', title: 'Alpha Hacks' })], { now: NOW, endedCutoff: CUTOFF });
  const later = new Date(NOW.getTime() + 1000);
  integrate(store, [item({ platform: 'mlh', sourceId: 'x', title: 'Alpha Hacks Fall', startDate: '2026-11-14' })], { now: later, endedCutoff: CUTOFF });
  assert.equal(store.events.size, 2);
  // A seed now links both source ids: pass 1 joins them, the newer page redirects.
  const seed = item({ platform: 'seed', sourceId: 'alpha', title: 'Alpha Hacks', lastCheckedAt: NOW.toISOString(), extraSources: [{ platform: 'devpost', sourceId: '7' }, { platform: 'mlh', sourceId: 'x' }] });
  const res = integrate(store, [seed], { now: later, endedCutoff: CUTOFF });
  assert.equal(store.events.size, 1);
  assert.equal(res.absorbed.length, 1);
  assert.deepEqual(store.redirects, { 'alpha-hacks-fall-2026': 'alpha-hacks-2026' });
});

test('store: old ended events are not back-filled, curated seeds are', () => {
  const store = emptyStore();
  const old = item({ sourceId: 'old', title: 'Old Hack', startDate: '2025-01-01', endDate: '2025-01-02' });
  const seed = item({ platform: 'seed', sourceId: 'sih-2025', title: 'Smart India Hackathon 2025', startDate: '2025-12-08', endDate: '2025-12-12', lastCheckedAt: NOW.toISOString() });
  const res = integrate(store, [old, seed], { now: NOW, endedCutoff: CUTOFF });
  assert.equal(res.skippedOld, 1);
  assert.deepEqual(res.added, ['smart-india-hackathon-2025']);
});

test('slugs include the year once and never collide', () => {
  const taken = new Set(['cal-hacks-13-0-2026']);
  assert.equal(makeSlug(rec({ title: 'Cal Hacks 13.0', startDate: '2026-10-23' }), taken), 'cal-hacks-13-0-2026-2');
  assert.equal(makeSlug(rec({ title: 'HackMoney 2026', startDate: '2026-01-30' }), new Set()), 'hackmoney-2026');
});

test('pass 2 ignores edition numbers that one source drops', () => {
  const dp = rec({ platform: 'devpost', sourceId: 's1', title: 'SpartaHack 12', organiser: 'SpartaHack', startDate: '2027-02-06' });
  const mlh = rec({ platform: 'mlh', sourceId: 'm9', title: 'SpartaHack', startDate: '2027-02-06T15:00:00Z', mode: 'in-person', countryCode: 'US' });
  assert.equal(pass2Match(dp, mlh), true);
});

test('store: a day-only refresh never replaces an exact stored time', () => {
  const store = emptyStore();
  integrate(store, [item({ sourceId: '9', title: 'Nine', startDate: '2026-08-26T23:30:00.000Z', endDate: '2026-09-01T03:45:00.000Z' })], { now: NOW, endedCutoff: CUTOFF });
  integrate(store, [item({ sourceId: '9', title: 'Nine', startDate: '2026-08-26', endDate: '2026-08-31' })], { now: NOW, endedCutoff: CUTOFF });
  const e = [...store.events.values()][0];
  assert.equal(e.startDate, '2026-08-26T23:30:00.000Z');
  assert.equal(e.endDate, '2026-09-01T03:45:00.000Z');
  // A real change of date still goes through.
  integrate(store, [item({ sourceId: '9', title: 'Nine', startDate: '2026-09-10', endDate: '2026-09-12' })], { now: NOW, endedCutoff: CUTOFF });
  assert.equal([...store.events.values()][0].startDate, '2026-09-10');
});

test('store: two fresh records for one page merge by source priority, not arrival order', () => {
  const store = emptyStore();
  integrate(store, [item({ platform: 'devfolio', sourceId: 'd1', title: 'SpartaHack', startDate: '2026-11-01', extraSources: [{ platform: 'mlh', sourceId: 'm1' }] })], { now: NOW, endedCutoff: CUTOFF });
  // Next run the two listings no longer dedupe in-run (Devfolio renamed it),
  // but both map to the same stored page.
  const df = item({ platform: 'devfolio', sourceId: 'd1', title: 'SpartaHack XII', startDate: '2026-11-01' });
  const mlh = item({ platform: 'mlh', sourceId: 'm1', title: 'SpartaHack', startDate: '2026-11-03' });
  integrate(store, [df, mlh], { now: NOW, endedCutoff: CUTOFF });
  const e = [...store.events.values()][0];
  assert.equal(store.events.size, 1);
  assert.equal(e.applyPlatform, 'devfolio');
  assert.equal(e.startDate, '2026-11-01');
});

test('store: a stated series replaces a derived one', () => {
  const store = emptyStore();
  integrate(store, [item({ sourceId: 's1', title: 'Bar Hacks 2' })], { now: NOW, endedCutoff: CUTOFF });
  const e0 = [...store.events.values()][0];
  Object.assign(e0, { series: 'Bar Hacks', seriesDerived: true });
  integrate(store, [item({ sourceId: 's1', title: 'Bar Hacks 2', series: 'Bar Org' })], { now: NOW, endedCutoff: CUTOFF });
  const e = [...store.events.values()][0];
  assert.equal(e.series, 'Bar Org');
  assert.equal(e.seriesDerived, undefined);
});

test('store: location moves as one group', () => {
  const store = emptyStore();
  integrate(store, [item({ sourceId: 'l1', title: 'Loc', mode: 'in-person', city: 'Paris', countryCode: 'FR', locationText: 'Station F' })], { now: NOW, endedCutoff: CUTOFF });
  integrate(store, [item({ sourceId: 'l1', title: 'Loc', mode: 'in-person', countryCode: 'US' })], { now: NOW, endedCutoff: CUTOFF });
  const e = [...store.events.values()][0];
  assert.deepEqual([e.city, e.country, e.locationText], [null, 'United States', null]);
  // A thinner refresh with no place keeps the stored place.
  integrate(store, [item({ sourceId: 'l1', title: 'Loc', mode: 'in-person' })], { now: NOW, endedCutoff: CUTOFF });
  assert.equal([...store.events.values()][0].country, 'United States');
});

test('store: a merge keeps the published URL and its publishedAt', () => {
  const store = emptyStore();
  integrate(store, [item({ platform: 'devpost', sourceId: 'a', title: 'Alpha One' })], { now: NOW, endedCutoff: CUTOFF });
  integrate(store, [item({ platform: 'mlh', sourceId: 'b', title: 'Beta Two', startDate: '2026-11-14' })], { now: NOW, endedCutoff: CUTOFF });
  store.events.get('beta-two-2026').publishedAt = NOW.toISOString(); // only b is live
  const seed = item({ platform: 'seed', sourceId: 'ab', title: 'Alpha One', lastCheckedAt: NOW.toISOString(), extraSources: [{ platform: 'devpost', sourceId: 'a' }, { platform: 'mlh', sourceId: 'b' }] });
  integrate(store, [seed], { now: NOW, endedCutoff: CUTOFF });
  assert.deepEqual(store.redirects, { 'alpha-one-2026': 'beta-two-2026' });
  assert.equal(store.events.get('beta-two-2026').publishedAt, NOW.toISOString());
});

test('unsafe links are dropped; a listing with no http(s) link is rejected', () => {
  assert.throws(() => rec({ url: 'javascript:alert(1)', applyUrl: 'javascript:alert(1)' }), /no valid http/);
  const r = rec({ url: 'https://ok.example/x', applyUrl: 'data:text/html,hi' });
  assert.equal(r.applyUrl, 'https://ok.example/x');
});

test('store: a run that only sees a lower-priority source cannot overwrite higher-priority facts', () => {
  const store = emptyStore();
  const dp = item({ platform: 'devpost', sourceId: '31110', title: 'hackPHS 2026', organiser: 'Princeton High School', startDate: '2026-10-10T04:00:00.000Z', endDate: '2026-10-11T14:45:00.000Z', mode: 'in-person', city: 'Princeton', countryCode: 'US', locationText: 'Princeton High School', prizeText: '$1,050 in prizes' });
  const mlh = item({ platform: 'mlh', sourceId: 'm7', title: 'hackPHS', startDate: '2026-10-10T13:00:00.000Z', endDate: '2026-10-11T16:30:00.000Z', mode: 'in-person', city: 'Princeton', countryCode: 'US' });
  integrate(store, dedupe([dp, mlh]).merged, { now: NOW, endedCutoff: CUTOFF });
  // Next run: the ended Devpost listing is not re-read; only MLH arrives.
  integrate(store, [item({ platform: 'mlh', sourceId: 'm7', title: 'hackPHS', startDate: '2026-10-10T13:00:00.000Z', endDate: '2026-10-11T16:30:00.000Z', mode: 'in-person', city: 'Princeton', countryCode: 'US', teamSizeText: 'Up to 4' })], { now: NOW, endedCutoff: CUTOFF });
  const e = [...store.events.values()][0];
  assert.equal(e.title, 'hackPHS 2026');
  assert.equal(e.startDate, '2026-10-10T04:00:00.000Z');
  assert.equal(e.applyPlatform, 'devpost');
  assert.equal(e.locationText, 'Princeton High School');
  assert.equal(e.teamSizeText, 'Up to 4', 'gaps are still filled');
});
