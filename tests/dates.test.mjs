import test from 'node:test';
import assert from 'node:assert/strict';
import { parseDevpostRange, parseOffsetDateTime, toInstant, toStoredDate } from '../pipeline/lib/dates.mjs';

test('Devpost date ranges', () => {
  assert.deepEqual(parseDevpostRange('Aug 26 - Oct 30, 2026'), { start: '2026-08-26', end: '2026-10-30', inverted: false });
  assert.deepEqual(parseDevpostRange('Oct 27, 2026'), { start: '2026-10-27', end: '2026-10-27' });
  assert.deepEqual(parseDevpostRange('Jan 08 - 10, 2027'), { start: '2027-01-08', end: '2027-01-10', inverted: false });
  assert.deepEqual(parseDevpostRange('Dec 15, 2026 - Jan 10, 2027'), { start: '2026-12-15', end: '2027-01-10', inverted: false });
  assert.deepEqual(parseDevpostRange('Dec 28 - Jan 03, 2027'), { start: '2026-12-28', end: '2027-01-03', inverted: false });
  assert.equal(parseDevpostRange('Oct 26 - 24, 2026').inverted, true);
  assert.equal(parseDevpostRange('soon'), null);
});

test('stored dates keep date-only values and never invent a time', () => {
  assert.equal(toStoredDate('2026-11-14'), '2026-11-14');
  assert.equal(toStoredDate('2026-11-14T10:00:00-05:00'), '2026-11-14T15:00:00.000Z');
  // No time zone: the day ends when it has ended everywhere (UTC-12).
  assert.equal(toInstant('2026-11-14', { endOfDay: true }).toISOString(), '2026-11-15T11:59:59.000Z');
  assert.equal(toInstant('2026-11-14').toISOString(), '2026-11-14T00:00:00.000Z');
  // Stated time zone: the day ends at local midnight.
  assert.equal(toInstant('2026-10-30', { endOfDay: true, tz: 'America/New_York' }).toISOString(), '2026-10-31T03:59:59.000Z');
  assert.equal(toInstant('2026-12-08', { tz: 'Asia/Kolkata' }).toISOString(), '2026-12-07T18:30:00.000Z');
});

test('offset date-times from HackerEarth', () => {
  assert.equal(parseOffsetDateTime('2026-10-28 18:00:00+05:30'), '2026-10-28T12:30:00.000Z');
});
