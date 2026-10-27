import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import * as devpost from '../pipeline/adapters/devpost.mjs';
import * as devfolio from '../pipeline/adapters/devfolio.mjs';
import * as mlh from '../pipeline/adapters/mlh.mjs';
import * as hackerearth from '../pipeline/adapters/hackerearth.mjs';
import * as ethglobal from '../pipeline/adapters/ethglobal.mjs';
import * as hackclub from '../pipeline/adapters/hackclub.mjs';
import * as seed from '../pipeline/adapters/seed.mjs';
import { normaliseListing } from '../pipeline/lib/record.mjs';
import { fetchAll } from '../pipeline/run.mjs';
import { NOW } from './helpers.mjs';

const fx = (f) => fs.readFileSync(new URL(`./fixtures/${f}`, import.meta.url), 'utf8');

test('devpost: list item plus detail page', () => {
  const detail = devpost.parseDetail(fx('devpost-detail.html'));
  assert.equal(detail.deadline, '2026-11-15T22:00:00.000Z');
  assert.equal(detail.teamSizeText, '2 to 4 members');
  assert.match(detail.eligibilityText, /^Ages 13\+ only; High school students only/);
  assert.deepEqual(detail.address, { city: 'Toronto', region: 'Ontario', country: 'Canada' });
  const listing = devpost.toListing({
    id: 99, title: 'Testville Hacks', url: 'https://testville.devpost.com/', organization_name: 'Testville',
    submission_period_dates: 'Nov 14 - 15, 2026', displayed_location: { icon: 'map-marker-alt', location: 'Test Library' },
    prize_amount: '$<span data-currency-value>5,000</span>', themes: [{ name: 'Education' }], open_state: 'upcoming',
  }, detail);
  const { record, sourceText } = normaliseListing(listing, NOW);
  assert.equal(record.city, 'Toronto');
  assert.equal(record.countryCode, 'CA');
  assert.equal(record.locationText, 'Test Library');
  assert.equal(record.startDate, '2026-11-14T15:00:00.000Z');
  assert.equal(record.prizeText, '$5,000 in prizes');
  assert.equal(record.deadlineKind, 'submission');
  assert.equal(record.eligibility, 'students');
  assert.match(sourceText, /local libraries/);
});

test('devpost: online and hybrid locations, zero prize', () => {
  assert.equal(devpost.placeFrom({ icon: 'globe', location: 'Online' }).mode, 'online');
  assert.equal(devpost.placeFrom({ icon: 'map-marker-alt', location: 'Santa Clara Convention Center + Online' }).mode, 'hybrid');
  assert.equal(devpost.prizeFromApi({ prize_amount: '$<span>0</span>' }), null);
});

test('devfolio: prizes as stated, personal data never copied', () => {
  const h = {
    uuid: 'u1', name: 'Test Hack', slug: 'test-hack', starts_at: '2026-11-01T00:30:00.000Z', ends_at: '2026-11-01T18:30:00.000Z',
    is_online: false, city: 'Surat', country: 'India', timezone: 'Asia/Calcutta', team_min: 1, team_size: 4,
    participants_details: [{ first_name: 'Private', username: 'private' }],
    hackathon_setting: { subdomain: 'test-hack', reg_ends_at: '2026-10-28T18:30:00.000Z', contact_email: 'private@example.com' },
    themes: [{ name: 'AI' }],
  };
  const l = devfolio.toListing(h, [{ name: 'First Place', amount: '15000.0000', currency: 'INR', quantity: 1 }, { name: 'Second Place', amount: '8000.0000', currency: 'INR', quantity: 1 }]);
  assert.equal(l.prizeText, 'First Place: INR 15,000; Second Place: INR 8,000');
  assert.equal(l.teamSizeText, '1 to 4 per team');
  const { record } = normaliseListing(l, NOW);
  const json = JSON.stringify(record);
  assert.ok(!json.includes('private'), 'no participant or contact data in the record');
  assert.equal(record.country, 'India');
});

test('mlh: embedded season JSON', () => {
  const page = mlh.extractPageJson(fx('mlh-season.html'));
  const [a, b] = page.props.upcomingEvents.map(mlh.toListing).map((l) => normaliseListing(l, NOW).record);
  assert.equal(a.applyUrl, 'https://www.mlh.com/events/testville-hacks');
  assert.equal(a.mode, 'in-person');
  assert.equal(a.countryCode, 'CA');
  assert.equal(b.mode, 'hybrid');
  assert.equal(b.city, 'New Delhi');
  assert.deepEqual(mlh.seasonsFor(new Date('2026-10-27T00:00:00Z')), [2027, 2028]);
  assert.deepEqual(mlh.seasonsFor(new Date('2027-03-01T00:00:00Z')), [2027, 2028]);
});

test('hackerearth: only hackathons, times converted', () => {
  assert.equal(hackerearth.isHackathon({ title: 'Monthly Easy Contest', challenge_type: 'Competitive' }), false);
  const l = hackerearth.toListing({ title: 'Test AI Hackathon', url: 'https://www.hackerearth.com/challenges/hackathon/test-ai/', start_utc_tz: '2026-10-28 12:30:00+00:00', end_utc_tz: '2026-11-06 18:29:00+00:00', time: '06:00 PM IST (Asia/Kolkata)', college: true });
  assert.equal(l.sourceId, 'test-ai');
  assert.equal(l.timezone, 'Asia/Kolkata');
  assert.equal(normaliseListing(l, NOW).record.eligibility, 'students');
});

test('ethglobal: hackathons only from the flight data', () => {
  const events = ethglobal.extractEvents(fx('ethglobal.html'));
  assert.equal(events.length, 2);
  const hacks = events.filter((e) => e.type === 'hackathon');
  const { record } = normaliseListing(ethglobal.toListing(hacks[0]), NOW);
  assert.equal(record.registrationDeadline, '2026-11-10T12:00:00.000Z');
  assert.equal(record.series, 'ETHGlobal');
  assert.deepEqual(record.niches, ['Web3']);
  assert.equal(record.country, 'Portugal');
});

test('hackclub: website is the apply link, students by directory scope', () => {
  const { record } = normaliseListing(hackclub.toListing({ id: 'abc', name: 'Teen Hack', website: 'https://teenhack.example', start: '2026-12-05T16:00:00.000Z', end: '2026-12-06T04:30:00.000Z', city: 'Pleasanton', countryCode: 'US', virtual: false, hybrid: false }), NOW);
  assert.equal(record.applyUrl, 'https://teenhack.example');
  assert.equal(record.eligibility, 'students');
  assert.ok(record.niches.includes('Student'));
});

test('seed: validates the documented format', () => {
  assert.throws(() => seed.toListing({ title: 'X', sources: [{ platform: 'devpost', sourceId: '1' }] }), /first source must be/);
  const data = JSON.parse(fs.readFileSync(new URL('../data/seed-events.json', import.meta.url), 'utf8'));
  for (const e of data.events) normaliseListing(seed.toListing(e), NOW);
});

test('one failing adapter does not stop the others', async () => {
  const sources = {};
  const health = { source: (p, d) => { sources[p] = d; } };
  const good = { platform: 'hackclub', fetch: async () => ({ listings: [hackclub.toListing({ id: 'a', name: 'A Hack', website: 'https://a.example', start: '2026-12-05T16:00:00Z', end: '2026-12-06T04:00:00Z', virtual: true })], errors: [], fetched: 1 }) };
  const broken = { platform: 'devpost', fetch: async () => { throw new Error('HTTP 500 for https://devpost.com/api/hackathons'); } };
  const out = await fetchAll([broken, good], { now: NOW, log: () => {} }, health);
  assert.equal(out.length, 1);
  assert.equal(sources.devpost.ok, false);
  assert.match(sources.devpost.errors[0], /HTTP 500/);
  assert.equal(sources.hackclub.ok, true);
  assert.equal(sources.hackclub.normalised, 1);
});

test('location strings: city before state/province, never a bare state code', async () => {
  const { parseLocationString } = await import('../pipeline/lib/geo.mjs');
  assert.deepEqual(parseLocationString('Toronto, ON, Canada'), { city: 'Toronto', countryCode: 'CA' });
  assert.deepEqual(parseLocationString('New York, NY, United States'), { city: 'New York', countryCode: 'US' });
  assert.deepEqual(parseLocationString('Venue Hall, Kanglung, Bhutan'), { city: 'Kanglung', countryCode: 'BT' });
  assert.deepEqual(parseLocationString('CA, USA'), { city: null, countryCode: 'US' });
  assert.deepEqual(parseLocationString('San Francisco, California'), { city: 'San Francisco', countryCode: 'US' });
});
