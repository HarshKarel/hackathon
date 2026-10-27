import test from 'node:test';
import assert from 'node:assert/strict';
import { calendar, deadlineVevent, eventVevents } from '../src/_lib/ics.js';
import { renderCard } from '../src/assets/js/card.js';
import { fmtRange, fmtDateTime } from '../src/assets/js/format.js';
import { computeStatus, deadlineState } from '../pipeline/lib/status.mjs';
import { qualityScore } from '../pipeline/lib/quality.mjs';

const e = {
  slug: 'test-hack-2026', title: 'Test Hack, with a comma; and semicolon', startDate: '2026-11-14', endDate: '2026-11-15',
  registrationDeadline: '2026-11-10T12:00:00.000Z', deadlineKind: 'registration', mode: 'online', applyUrl: 'https://x.example/', applyName: 'Devpost',
  summary: 'A short line.',
};

test('ICS: CRLF, escaping, all-day dates, folded lines', () => {
  const ics = calendar({ name: 'Test', description: 'd', events: eventVevents(e, 'https://hackathon.so', '2026-10-27T00:00:00Z') });
  assert.ok(ics.includes('\r\n'));
  assert.ok(!/[^\r]\n/.test(ics), 'every newline is CRLF');
  assert.match(ics, /DTSTART;VALUE=DATE:20261114\r\nDTEND;VALUE=DATE:20261116/);
  assert.ok(ics.includes('SUMMARY:Test Hack\\, with a comma\\; and semicolon'));
  for (const line of ics.split('\r\n')) assert.ok(Buffer.byteLength(line) <= 75, `line too long: ${line}`);
  const dl = calendar({ name: 'D', description: 'd', events: [deadlineVevent(e, 'https://hackathon.so', '2026-10-27T00:00:00Z')] });
  assert.match(dl, /DTSTART:20261110T120000Z\r\nSUMMARY/, 'a deadline is a point in time: no DTEND');
  const mixed = calendar({ name: 'M', description: 'd', events: [eventVevents({ ...e, startDate: '2026-11-14T15:00:00.000Z', endDate: '2026-11-16', registrationDeadline: null }, 'https://hackathon.so', '2026-10-27T00:00:00Z')].flat() });
  assert.match(mixed, /DTSTART;VALUE=DATE:20261114\r\nDTEND;VALUE=DATE:20261117/);
  assert.match(dl, /TRIGGER:-P1D/);
});

test('date ranges read naturally', () => {
  assert.equal(fmtRange('2026-11-07', '2026-11-08'), '7 to 8 Nov 2026');
  assert.equal(fmtRange('2026-10-30', '2026-12-04'), '30 Oct to 4 Dec 2026');
  assert.equal(fmtRange('2026-12-15', '2027-01-10'), '15 Dec 2026 to 10 Jan 2027');
  assert.equal(fmtDateTime('2026-10-30T17:00:00.000Z'), '30 Oct 2026, 17:00 UTC');
  assert.equal(fmtDateTime('2026-12-04'), '4 Dec 2026 (time not stated)');
});

test('card shows the deadline and escapes HTML', () => {
  const html = renderCard({ slug: 's', title: '<b>X</b>', status: 'upcoming', mode: 'online', niches: ['Open'], deadline: '2026-11-10', deadlineKind: 'registration', start: '2026-11-14', end: '2026-11-15', platforms: ['Devpost'] }, new Date('2026-10-27T00:00:00Z'));
  assert.match(html, /Registration closes/);
  assert.match(html, /10 Nov 2026/);
  assert.ok(html.includes('&lt;b&gt;X&lt;/b&gt;'));
  assert.ok(!html.includes('\u2014'));
  const none = renderCard({ slug: 's', title: 'Y', status: 'upcoming', mode: 'online', niches: [], start: '2026-11-14', end: '2026-11-15', platforms: ['MLH'] });
  assert.match(none, /No deadline stated/);
});

test('status flows upcoming, live, ended', () => {
  const ev = { startDate: '2026-11-14', endDate: '2026-11-15' };
  assert.equal(computeStatus(ev, new Date('2026-11-13T23:00:00Z')), 'upcoming');
  assert.equal(computeStatus(ev, new Date('2026-11-15T23:00:00Z')), 'live');
  assert.equal(computeStatus(ev, new Date('2026-11-16T00:00:01Z')), 'live', 'still 15 Nov somewhere');
  assert.equal(computeStatus(ev, new Date('2026-11-16T12:00:01Z')), 'ended');
});

test('quality score and floor', () => {
  const full = { startDate: 'a', endDate: 'b', registrationDeadline: 'c', applyUrl: 'https://x', prizeText: '$1', descriptionStatus: 'ai' };
  assert.deepEqual(qualityScore(full), { score: 100, missing: [], indexable: true });
  const thin = { startDate: 'a', endDate: 'b', applyUrl: 'https://x', descriptionStatus: 'placeholder' };
  assert.equal(qualityScore(thin).score, 40);
  assert.equal(qualityScore(thin).indexable, false);
});

test('a date-only deadline is not shown as passed while the day lasts', () => {
  // 21:00 EDT on 30 Oct is still the deadline day in New York.
  const at = new Date('2026-10-31T01:00:00Z');
  assert.equal(deadlineState({ registrationDeadline: '2026-10-30' }, at), 'open');
  assert.equal(deadlineState({ registrationDeadline: '2026-10-30', timezone: 'America/New_York' }, at), 'open');
  assert.equal(deadlineState({ registrationDeadline: '2026-10-30', timezone: 'Asia/Kolkata' }, at), 'passed');
});
