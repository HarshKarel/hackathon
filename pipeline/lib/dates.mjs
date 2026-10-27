// Dates are stored either as a full ISO instant ("2026-11-03T18:29:00.000Z",
// when the source states a time) or as a plain date ("2026-12-04", when it
// only states a day). We never invent a time the source did not give.

import { dateBound } from '../../src/assets/js/format.js';

const MONTHS = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, sept: 9, oct: 10, nov: 11, dec: 12 };

export const isDateOnly = (v) => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v);

const pad = (n) => String(n).padStart(2, '0');
const ymd = (y, m, d) => `${y}-${pad(m)}-${pad(d)}`;

export function validYmd(y, m, d) {
  const dt = new Date(Date.UTC(y, m - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d;
}

// Normalise any source value to our storage form, or null.
export function toStoredDate(v) {
  if (v == null || v === '') return null;
  if (isDateOnly(v)) return v;
  const d = new Date(v);
  if (Number.isNaN(d.getTime())) return null;
  return d.toISOString();
}

// Convert a stored date to an instant for comparisons. Date-only values use
// the event's time zone when known; otherwise they start at 00:00 UTC and end
// at 23:59:59 UTC-12 (see dateBound in src/assets/js/format.js, shared with
// the browser).
export function toInstant(v, { endOfDay = false, tz = null } = {}) {
  return dateBound(v, { end: endOfDay, tz });
}

export function dayKey(v) {
  if (!v) return null;
  if (isDateOnly(v)) return v;
  return new Date(v).toISOString().slice(0, 10);
}

export function daysBetween(a, b) {
  return Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86_400_000);
}

// Devpost list dates: "Aug 26 - Oct 30, 2026", "Oct 27, 2026",
// "Jan 08 - 10, 2027", "Dec 15, 2026 - Jan 10, 2027".
export function parseDevpostRange(text) {
  if (!text) return null;
  const s = String(text).replace(/\s+/g, ' ').replace(/[\u2013\u2014]/g, '-').trim();
  const m = s.match(/^([A-Za-z]{3,4})\.? (\d{1,2})(?:, (\d{4}))?(?: - (?:([A-Za-z]{3,4})\.? )?(\d{1,2}), (\d{4}))?$/);
  if (!m) return null;
  const [, m1, d1, y1, m2, d2, y2] = m;
  const sm = MONTHS[m1.toLowerCase()];
  if (!sm) return null;
  if (!d2) {
    if (!y1) return null;
    const one = ymd(+y1, sm, +d1);
    return validYmd(+y1, sm, +d1) ? { start: one, end: one } : null;
  }
  const em = m2 ? MONTHS[m2.toLowerCase()] : sm;
  if (!em) return null;
  const ey = +y2;
  const sy = y1 ? +y1 : (em < sm ? ey - 1 : ey);
  if (!validYmd(sy, sm, +d1) || !validYmd(ey, em, +d2)) return null;
  const start = ymd(sy, sm, +d1);
  const end = ymd(ey, em, +d2);
  return { start, end, inverted: end < start };
}

// "2026-10-28 18:00:00+05:30" -> ISO instant
export function parseOffsetDateTime(s) {
  if (!s) return null;
  const v = String(s).trim().replace(' ', 'T').replace(/([+-]\d{2})(\d{2})$/, '$1:$2');
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}
