// Date and label formatting shared by the build and the browser.

export const isDateOnly = (v) => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v);

const asDate = (v) => (isDateOnly(v) ? new Date(`${v}T12:00:00Z`) : new Date(v));

function tzOrUtc(v, tz) {
  if (isDateOnly(v) || !tz) return 'UTC';
  try {
    new Intl.DateTimeFormat('en-GB', { timeZone: tz });
    return tz;
  } catch {
    return 'UTC';
  }
}

export function fmtDate(v, tz) {
  if (!v) return '';
  return asDate(v).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: tzOrUtc(v, tz) });
}

export function fmtDateLong(v, tz) {
  if (!v) return '';
  return asDate(v).toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'long', year: 'numeric', timeZone: tzOrUtc(v, tz) });
}

// "30 Oct 2026, 17:00 UTC" or, with a stated time zone,
// "28 Oct 2026, 00:00 GMT+5:30 (Asia/Calcutta)".
export function fmtDateTime(v, tz) {
  if (!v) return '';
  if (isDateOnly(v)) return `${fmtDate(v)} (time not stated)`;
  const zone = tzOrUtc(v, tz);
  const d = new Date(v);
  const day = d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: zone });
  const time = d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', hour12: false, timeZone: zone, timeZoneName: 'short' });
  return zone === 'UTC' ? `${day}, ${time}` : `${day}, ${time} (${zone})`;
}

const parts = (v, tz) => {
  const zone = tzOrUtc(v, tz);
  const d = asDate(v);
  const get = (o) => d.toLocaleDateString('en-GB', { ...o, timeZone: zone });
  return { day: get({ day: 'numeric' }), month: get({ month: 'short' }), year: get({ year: 'numeric' }) };
};

// "7 to 8 Nov 2026", "30 Oct to 4 Dec 2026", "15 Dec 2026 to 10 Jan 2027"
export function fmtRange(start, end, tz) {
  if (!start) return '';
  const a = parts(start, tz);
  if (!end) return `${a.day} ${a.month} ${a.year}`;
  const b = parts(end, tz);
  if (a.year === b.year && a.month === b.month && a.day === b.day) return `${a.day} ${a.month} ${a.year}`;
  if (a.year === b.year && a.month === b.month) return `${a.day} to ${b.day} ${b.month} ${b.year}`;
  if (a.year === b.year) return `${a.day} ${a.month} to ${b.day} ${b.month} ${b.year}`;
  return `${a.day} ${a.month} ${a.year} to ${b.day} ${b.month} ${b.year}`;
}

export const STATUS_LABELS = { upcoming: 'Upcoming', live: 'Live', ended: 'Ended' };
export const MODE_LABELS = { online: 'Online', 'in-person': 'In person', hybrid: 'Hybrid' };
export const DEADLINE_LABELS = { registration: 'Registration deadline', submission: 'Submission deadline' };

function validTz(tz) {
  if (!tz) return false;
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

// Offset of a time zone from UTC at a given moment, in milliseconds.
function tzOffsetMs(date, tz) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: tz, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit',
  }).formatToParts(date);
  const get = (t) => Number(parts.find((p) => p.type === t).value);
  return Date.UTC(get('year'), get('month') - 1, get('day'), get('hour'), get('minute'), get('second')) - date.getTime();
}

// Wall-clock time on a day in a time zone, as a UTC instant.
function zonedToUtc(ymd, [h, mi, sec], tz) {
  const [y, m, d] = ymd.split('-').map(Number);
  const wall = Date.UTC(y, m - 1, d, h, mi, sec);
  let guess = wall;
  for (let i = 0; i < 2; i++) guess = wall - tzOffsetMs(new Date(guess), tz);
  return new Date(guess);
}

// The instant a stored date begins or ends. Exact times are used as given.
// A date-only value is read in the event's stated time zone; with no time
// zone it starts at 00:00 UTC and ends when the day is over everywhere
// (23:59:59 at UTC-12, "anywhere on earth"), so an open deadline is never
// shown as passed too early.
export function dateBound(v, { end = false, tz = null } = {}) {
  if (!v) return null;
  if (!isDateOnly(v)) {
    const d = new Date(v);
    return Number.isNaN(d.getTime()) ? null : d;
  }
  if (validTz(tz)) return zonedToUtc(v, end ? [23, 59, 59] : [0, 0, 0], tz);
  return end ? new Date(`${v}T23:59:59-12:00`) : new Date(`${v}T00:00:00Z`);
}

export function deadlineInstant(v, tz) {
  return dateBound(v, { end: true, tz });
}

// "in 3 days", "in 5 hours", "2 days ago"
export function relative(v, now = new Date(), tz = null) {
  const d = deadlineInstant(v, tz);
  if (!d) return '';
  const ms = d - now;
  const abs = Math.abs(ms);
  const h = Math.round(abs / 3_600_000);
  const days = Math.round(abs / 86_400_000);
  const txt = abs < 3_600_000 ? 'less than an hour' : h < 36 ? `${h} hour${h === 1 ? '' : 's'}` : `${days} day${days === 1 ? '' : 's'}`;
  return ms >= 0 ? `in ${txt}` : `${txt} ago`;
}

export function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

export function slugifyLabel(s) {
  return String(s ?? '').toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '').replace(/ and /g, '-').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}
