// Minimal RFC 5545 calendar writer: CRLF line endings, 75-octet folding,
// text escaping, all-day events for date-only values.
import { isDateOnly } from '../assets/js/format.js';

const CRLF = '\r\n';

function esc(s) {
  return String(s ?? '').replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\r?\n/g, '\\n');
}

function fold(line) {
  const bytes = Buffer.from(line, 'utf8');
  if (bytes.length <= 75) return line;
  const out = [];
  let start = 0;
  let limit = 75;
  while (start < bytes.length) {
    let end = Math.min(start + limit, bytes.length);
    // Do not split a UTF-8 character.
    while (end < bytes.length && (bytes[end] & 0xc0) === 0x80) end -= 1;
    out.push(bytes.slice(start, end).toString('utf8'));
    start = end;
    limit = 74; // continuation lines start with a space
  }
  return out.join(`${CRLF} `);
}

const utc = (d) => new Date(d).toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
const ymd = (v) => v.replace(/-/g, '');
function nextDay(v) {
  const d = new Date(`${v}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10).replace(/-/g, '');
}

function timeProps(start, end, { point = false } = {}) {
  const startDay = isDateOnly(start);
  const endDay = end ? isDateOnly(end) : startDay;
  // All-day when either bound is a plain date (never invent a time).
  if (startDay || (end && endDay)) {
    const first = startDay ? start : new Date(start).toISOString().slice(0, 10);
    const last = end ? (endDay ? end : new Date(end).toISOString().slice(0, 10)) : first;
    return [`DTSTART;VALUE=DATE:${ymd(first)}`, `DTEND;VALUE=DATE:${nextDay(last < first ? first : last)}`];
  }
  // A deadline is a moment: DTSTART without DTEND (RFC 5545 3.6.1).
  if (point || !end) return [`DTSTART:${utc(start)}`];
  return [`DTSTART:${utc(start)}`, `DTEND:${utc(end)}`];
}

export function vevent({ uid, start, end, point, summary, description, url, location, stamp, alarm }) {
  const lines = ['BEGIN:VEVENT', `UID:${uid}`, `DTSTAMP:${utc(stamp)}`, ...timeProps(start, end, { point }), `SUMMARY:${esc(summary)}`];
  if (description) lines.push(`DESCRIPTION:${esc(description)}`);
  if (url) lines.push(`URL:${url}`);
  if (location) lines.push(`LOCATION:${esc(location)}`);
  if (alarm) lines.push('BEGIN:VALARM', 'ACTION:DISPLAY', `DESCRIPTION:${esc(summary)}`, 'TRIGGER:-P1D', 'END:VALARM');
  lines.push('END:VEVENT');
  return lines;
}

export function calendar({ name, description, events }) {
  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//hackathon.so//calendar feeds//EN',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    `X-WR-CALNAME:${esc(name)}`,
    `X-WR-CALDESC:${esc(description)}`,
    'REFRESH-INTERVAL;VALUE=DURATION:PT12H',
    'X-PUBLISHED-TTL:PT12H',
    ...events.flat(),
    'END:VCALENDAR',
  ];
  return lines.map(fold).join(CRLF) + CRLF;
}

const placeOf = (e) => (e.mode === 'online' ? 'Online' : [e.city, e.country].filter(Boolean).join(', ') || e.locationText || '');

export function eventVevents(e, siteUrl, stamp, { alarm = false } = {}) {
  const page = `${siteUrl}/hackathons/${e.slug}/`;
  const out = [];
  out.push(vevent({
    uid: `${e.slug}-event@hackathon.so`,
    start: e.startDate,
    end: e.endDate,
    summary: e.title,
    description: `${e.summary || ''}\nDetails and apply link: ${page}`.trim(),
    url: page,
    location: placeOf(e),
    stamp,
  }));
  if (e.registrationDeadline) out.push(deadlineVevent(e, siteUrl, stamp, { alarm }));
  return out;
}

export function deadlineVevent(e, siteUrl, stamp, { alarm = true } = {}) {
  const page = `${siteUrl}/hackathons/${e.slug}/`;
  const kind = e.deadlineKind === 'submission' ? 'Submission deadline' : 'Registration deadline';
  return vevent({
    uid: `${e.slug}-deadline@hackathon.so`,
    start: e.registrationDeadline,
    end: null,
    point: true,
    summary: `${kind}: ${e.title}`,
    description: `${kind} for ${e.title}, as listed on ${e.applyName}.\nApply: ${e.applyUrl}\nDetails: ${page}`,
    url: page,
    stamp,
    alarm,
  });
}
