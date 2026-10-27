// MLH: each season page embeds its events as JSON in
// <script data-page="app" type="application/json">. mlh.io redirects to
// www.mlh.com, so we read www.mlh.com directly.
const BASE = 'https://www.mlh.com';

export function extractPageJson(html) {
  const m = html.match(/<script data-page="app" type="application\/json">([\s\S]*?)<\/script>/);
  if (!m) throw new Error('embedded JSON not found on MLH season page');
  return JSON.parse(m[1]);
}

const MODE = { physical: 'in-person', digital: 'online', hybrid_physical: 'hybrid', hybrid_digital: 'hybrid', hybrid: 'hybrid' };

export function toListing(e) {
  const mode = MODE[e.formatType] || (/hybrid/.test(e.formatType || '') ? 'hybrid' : /digital|online|virtual/.test(e.formatType || '') ? 'online' : 'in-person');
  const url = `${BASE}/events/${e.slug}`;
  const focus = e.customFields?.hackathon_focus || [];
  return {
    platform: 'mlh',
    sourceId: e.id,
    url,
    applyUrl: url,
    title: e.name,
    organiser: null,
    startDate: e.startsAt,
    endDate: e.endsAt,
    registrationDeadline: null,
    mode,
    city: e.venueAddress?.city || null,
    countryCode: e.venueAddress?.country || null,
    themes: Array.isArray(focus) ? focus.map(String) : [],
    // MLH is a student hackathon league: tag the niche, but leave the
    // eligibility value unstated because MLH does not state it per event.
    platformNiches: ['Student'],
    sourceText: '',
  };
}

// MLH seasons run from late summer to early summer: the 2027 season covers
// roughly August 2026 to July 2027.
export function seasonsFor(now) {
  const y = now.getUTCFullYear();
  const current = now.getUTCMonth() >= 6 ? y + 1 : y;
  return [current, current + 1];
}

export default {
  platform: 'mlh',
  async fetch({ http, now, log }) {
    const listings = [];
    const errors = [];
    const seen = new Set();
    for (const season of seasonsFor(now)) {
      let page;
      try {
        page = extractPageJson(await http.getText(`${BASE}/seasons/${season}/events`));
      } catch (err) {
        // The next season's page often does not exist yet.
        if (season !== seasonsFor(now)[0] && /HTTP 404/.test(err.message)) continue;
        throw err;
      }
      const props = page.props || {};
      const events = [...(props.upcomingEvents || []), ...(props.pastEvents || [])];
      for (const e of events) {
        if (seen.has(e.id)) continue;
        seen.add(e.id);
        try {
          listings.push(toListing(e));
        } catch (err) {
          errors.push(`mlh:${e.id}: ${err.message}`);
        }
      }
      log(`mlh: season ${season}: ${props.upcomingEvents?.length || 0} upcoming, ${props.pastEvents?.length || 0} past`);
    }
    return { listings, errors, fetched: seen.size };
  },
};
