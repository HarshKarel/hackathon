// ETHGlobal: the /events page streams its data in Next.js flight chunks
// (self.__next_f.push). Event objects are pulled out of that stream and only
// type "hackathon" is kept (no meetups, summits or cafes).
const BASE = 'https://ethglobal.com';

export function extractEvents(html) {
  let buf = '';
  for (const m of html.matchAll(/self\.__next_f\.push\((\[[\s\S]*?\])\)<\/script>/g)) {
    try {
      const arr = JSON.parse(m[1]);
      if (typeof arr[1] === 'string') buf += arr[1];
    } catch {
      /* skip chunks that are not plain JSON arrays */
    }
  }
  if (!buf) throw new Error('no flight data on ETHGlobal events page');
  const events = new Map();
  const re = /\{"id":\d+,"name":"(?:[^"\\]|\\.)*","slug":"(?:[^"\\]|\\.)*","type":"/g;
  for (const m of buf.matchAll(re)) {
    const obj = readJsonObject(buf, m.index);
    if (obj && obj.id != null) events.set(obj.id, obj);
  }
  return [...events.values()];
}

// Read one JSON object starting at index i by matching braces.
function readJsonObject(s, i) {
  let depth = 0;
  let inStr = false;
  for (let j = i; j < s.length; j++) {
    const c = s[j];
    if (inStr) {
      if (c === '\\') j += 1;
      else if (c === '"') inStr = false;
      continue;
    }
    if (c === '"') inStr = true;
    else if (c === '{') depth += 1;
    else if (c === '}') {
      depth -= 1;
      if (depth === 0) {
        try { return JSON.parse(s.slice(i, j + 1)); } catch { return null; }
      }
    }
  }
  return null;
}

export function toListing(e) {
  const url = `${BASE}/events/${e.slug}`;
  return {
    platform: 'ethglobal',
    sourceId: e.id,
    url,
    applyUrl: url,
    title: e.name,
    organiser: 'ETHGlobal',
    series: 'ETHGlobal',
    startDate: e.startTime,
    endDate: e.endTime,
    registrationDeadline: e.signupDeadline || null,
    deadlineKind: 'registration',
    mode: e.medium === 'virtual' ? 'online' : e.medium === 'hybrid' ? 'hybrid' : 'in-person',
    city: e.medium === 'virtual' ? null : e.city?.name || null,
    countryCode: e.medium === 'virtual' ? null : e.city?.countryCode || e.city?.country?.name || null,
    platformNiches: ['Web3'],
    sourceText: e.tagline || '',
  };
}

export default {
  platform: 'ethglobal',
  async fetch({ http, log }) {
    const all = extractEvents(await http.getText(`${BASE}/events`));
    const hacks = all.filter((e) => e.type === 'hackathon' && e.status !== 'cancelled');
    const listings = [];
    const errors = [];
    for (const e of hacks) {
      try {
        listings.push(toListing(e));
      } catch (err) {
        errors.push(`ethglobal:${e.id}: ${err.message}`);
      }
    }
    log(`ethglobal: ${all.length} events on page, ${hacks.length} hackathons`);
    return { listings, errors, fetched: all.length };
  },
};
