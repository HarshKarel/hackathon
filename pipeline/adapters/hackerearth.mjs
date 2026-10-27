// HackerEarth: public events JSON at /chrome-extension/events/. The feed
// mixes hackathons with programming contests; only hackathons are kept.
import { parseOffsetDateTime } from '../lib/dates.mjs';

const FEED = 'https://www.hackerearth.com/chrome-extension/events/';

export function isHackathon(e) {
  return /hackathon/i.test(e.challenge_type || '') || /\/hackathon\//.test(e.url || '') || /\bhack/i.test(e.title || '');
}

export function toListing(e) {
  const slug = (e.url || '').replace(/\/+$/, '').split('/').pop();
  const tz = (e.time || '').match(/\(([A-Za-z_]+\/[A-Za-z_]+)\)/);
  return {
    platform: 'hackerearth',
    sourceId: slug || e.url,
    url: e.url,
    applyUrl: e.url,
    title: e.title,
    organiser: null,
    startDate: parseOffsetDateTime(e.start_utc_tz || e.start_tz),
    endDate: parseOffsetDateTime(e.end_utc_tz || e.end_tz),
    registrationDeadline: null,
    timezone: tz ? tz[1] : null,
    // HackerEarth hackathons run on its online platform.
    mode: 'online',
    platformNiches: e.college ? ['Student'] : [],
    eligibilityDefault: e.college ? 'students' : null,
    sourceText: e.description || '',
  };
}

export default {
  platform: 'hackerearth',
  async fetch({ http, log }) {
    const data = await http.getJson(FEED);
    const all = data.response || [];
    const hacks = all.filter(isHackathon);
    const listings = [];
    const errors = [];
    for (const e of hacks) {
      try {
        listings.push(toListing(e));
      } catch (err) {
        errors.push(`hackerearth:${e.url}: ${err.message}`);
      }
    }
    log(`hackerearth: ${all.length} events in feed, ${hacks.length} hackathons`);
    return { listings, errors, fetched: all.length };
  },
};
