// Hack Club: public API of the high school hackathons directory
// (hackathons.hackclub.com/api/events/all/). The directory has no page per
// event; it links each event's own website, so that is the apply link.
const API = 'https://hackathons.hackclub.com/api/events/all/';

export function toListing(e) {
  const mode = e.virtual ? 'online' : e.hybrid ? 'hybrid' : 'in-person';
  return {
    platform: 'hackclub',
    sourceId: e.id,
    url: e.website,
    applyUrl: e.website,
    title: e.name,
    organiser: null,
    startDate: e.start,
    endDate: e.end,
    registrationDeadline: null,
    mode,
    city: mode === 'online' ? null : e.city || null,
    countryCode: mode === 'online' ? null : e.countryCode || e.country || null,
    platformNiches: ['Student'],
    // The directory lists high school hackathons only.
    eligibilityDefault: 'students',
    sourceText: '',
  };
}

export default {
  platform: 'hackclub',
  async fetch({ http, log }) {
    const all = await http.getJson(API);
    const listings = [];
    const errors = [];
    for (const e of all) {
      if (!e.website) {
        errors.push(`hackclub:${e.id}: no website`);
        continue;
      }
      try {
        listings.push(toListing(e));
      } catch (err) {
        errors.push(`hackclub:${e.id}: ${err.message}`);
      }
    }
    log(`hackclub: ${all.length} events in directory`);
    return { listings, errors, fetched: all.length };
  },
};
