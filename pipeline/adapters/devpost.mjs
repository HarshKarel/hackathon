// Devpost: public JSON API at devpost.com/api/hackathons, plus each open or
// upcoming hackathon's own page for the exact deadline and the "Who can
// participate" list.
import { DEVPOST_DETAIL_LIMIT } from '../config.mjs';
import { parseDevpostRange, toInstant } from '../lib/dates.mjs';
import { parseLocationString } from '../lib/geo.mjs';
import { decodeEntities, stripTags } from '../lib/text.mjs';

const API = 'https://devpost.com/api/hackathons';

function listUrl(statuses, page, orderBy) {
  const q = statuses.map((s) => `status%5B%5D=${s}`).join('&');
  return `${API}?${q}&per_page=40&page=${page}${orderBy ? `&order_by=${orderBy}` : ''}`;
}

export function prizeFromApi(h) {
  const amount = decodeEntities(stripTags(h.prize_amount || '')).replace(/\s+/g, '').trim();
  const digits = amount.replace(/[^0-9]/g, '');
  if (!digits || /^0+$/.test(digits)) return null;
  return `${amount} in prizes`;
}

// Pull the facts we use from a hackathon's Devpost page: the exact deadline,
// the "Who can participate" list, and the page's Event JSON-LD (exact start
// and end, street address, full description for the copy check).
export function parseDetail(html) {
  const out = {};
  const iso = html.match(/data-dates-text[^>]*data-iso-date="([^"]+)"/) || html.match(/<time id="time-left"[^>]*datetime="([^"]+)"[^>]*>[^<]*<\/time>\s*to deadline/);
  if (iso && iso[1]) out.deadline = new Date(iso[1]).toISOString();
  const list = html.match(/<ul id="eligibility-list"[^>]*>([\s\S]*?)<\/ul>/);
  if (list) {
    const items = [...list[1].matchAll(/<li[^>]*>([\s\S]*?)<\/li>/g)]
      .map((m) => decodeEntities(stripTags(m[1])).replace(/\s+/g, ' ').trim())
      .filter(Boolean);
    const team = items.find((i) => /^team (required|size)/i.test(i));
    if (team) out.teamSizeText = team.replace(/^team (required|size)\s*:?\s*/i, '');
    const elig = items.filter((i) => i !== team);
    if (elig.length) out.eligibilityText = elig.join('; ');
  }
  const ld = html.match(/<script type="application\/ld\+json"[^>]*>([\s\S]*?)<\/script>/);
  if (ld) {
    try {
      const j = JSON.parse(ld[1]);
      if (j.startDate && !Number.isNaN(Date.parse(j.startDate))) out.startDate = new Date(j.startDate).toISOString();
      if (j.endDate && !Number.isNaN(Date.parse(j.endDate))) out.endDate = new Date(j.endDate).toISOString();
      const a = j.location?.address;
      if (a && typeof a === 'object') {
        const street = String(a.streetAddress || '');
        const lastPart = street.split(',').map((s) => s.trim()).filter(Boolean).pop();
        out.address = { city: a.addressLocality || null, region: a.addressRegion || null, country: a.addressCountry || lastPart || null };
      }
      if (j.description) out.sourceText = decodeEntities(stripTags(decodeEntities(j.description)));
    } catch {
      /* malformed JSON-LD: fall back to the list data */
    }
  }
  if (!out.sourceText) {
    const desc = html.match(/<meta property="og:description" content="([^"]*)"/) || html.match(/<meta name="description" content="([^"]*)"/);
    if (desc) out.sourceText = decodeEntities(desc[1]);
  }
  return out;
}

export function placeFrom(loc, address) {
  const text = String(loc?.location || '').trim();
  const online = loc?.icon === 'globe' || /^online$/i.test(text);
  const hybrid = !online && /(\+|&|and)\s*online\b|\bonline\s*(\+|&)|hybrid/i.test(text);
  if (online) return { mode: 'online', city: null, countryCode: null, locationText: null };
  let city = null;
  let countryCode = null;
  if (address) {
    const p = parseLocationString([address.city, address.region, address.country].filter(Boolean).join(', '));
    countryCode = p.countryCode;
    city = address.city || p.city;
  }
  if (!countryCode) {
    const p = parseLocationString(text.replace(/\s*(\+|&)\s*online\b/i, ''));
    if (p.countryCode) { countryCode = p.countryCode; city = city || p.city; }
  }
  // The list API often gives a venue name rather than a city. Keep it as the
  // stated location text instead of guessing a city from it.
  return { mode: hybrid ? 'hybrid' : 'in-person', city, countryCode, locationText: text || null };
}

export function toListing(h, detail = {}) {
  const range = parseDevpostRange(h.submission_period_dates);
  if (!range) throw new Error(`devpost:${h.id}: cannot read dates "${h.submission_period_dates}"`);
  const place = placeFrom(h.displayed_location, detail.address);
  const warnings = [];
  if (range.inverted && !(detail.startDate && detail.endDate)) warnings.push(`source dates "${h.submission_period_dates}" end before they start`);
  return {
    platform: 'devpost',
    sourceId: h.id,
    url: h.url,
    applyUrl: h.url,
    title: h.title,
    organiser: h.organization_name || null,
    // Exact times from the page's JSON-LD when we have it, else the days
    // from the list API.
    startDate: detail.startDate || range.start,
    endDate: detail.endDate || range.end,
    // Devpost states a submission deadline; anyone can join until then.
    registrationDeadline: detail.deadline || range.end,
    deadlineKind: 'submission',
    mode: place.mode,
    city: place.city,
    countryCode: place.countryCode,
    locationText: place.locationText,
    prizeText: prizeFromApi(h),
    themes: (h.themes || []).map((t) => t.name),
    eligibilityText: detail.eligibilityText || null,
    teamSizeText: detail.teamSizeText || null,
    inviteOnly: Boolean(h.invite_only),
    sourceText: detail.sourceText || '',
    warnings,
    raw: { openState: h.open_state },
  };
}

async function fetchList(http, statuses, { orderBy, stopBefore, maxPages = 30 } = {}) {
  const items = [];
  for (let page = 1; page <= maxPages; page++) {
    const data = await http.getJson(listUrl(statuses, page, orderBy));
    const batch = data.hackathons || [];
    if (!batch.length) break;
    items.push(...batch);
    if (stopBefore) {
      // Sorted by deadline, newest first. Stop once a whole page is older
      // than the window (one stale pinned item can appear first).
      const ends = batch.map((h) => parseDevpostRange(h.submission_period_dates)?.end).filter(Boolean);
      if (ends.length && ends.every((d) => toInstant(d, { endOfDay: true }) < stopBefore)) break;
    }
    if (items.length >= (data.meta?.total_count ?? Infinity)) break;
  }
  return items;
}

export default {
  platform: 'devpost',
  async fetch({ http, endedCutoff, knownSourceKeys = new Set(), log }) {
    const active = await fetchList(http, ['open', 'upcoming']);
    const ended = await fetchList(http, ['ended'], { orderBy: 'deadline', stopBefore: endedCutoff, maxPages: 12 });
    const listings = [];
    const errors = [];
    let details = 0;
    const seen = new Set();
    let skippedKnownEnded = 0;
    for (const h of [...active, ...ended]) {
      if (seen.has(h.id)) continue;
      seen.add(h.id);
      // An ended event already in the store was read in full (detail page
      // included) when first seen. Re-emitting its thinner list data would
      // only lose precision, so it is left as stored.
      if (h.open_state === 'ended' && knownSourceKeys.has(`devpost:${h.id}`)) {
        skippedKnownEnded += 1;
        continue;
      }
      let detail = {};
      // Open and upcoming pages are re-read every run (deadlines move);
      // ended pages only the first time we see the event.
      if (details < DEVPOST_DETAIL_LIMIT) {
        details += 1;
        try {
          detail = parseDetail(await http.getText(h.url));
        } catch (err) {
          errors.push(`detail ${h.url}: ${err.message}`);
        }
      }
      try {
        listings.push(toListing(h, detail));
      } catch (err) {
        errors.push(err.message);
      }
    }
    log(`devpost: ${active.length} open/upcoming, ${ended.length} ended in window (${skippedKnownEnded} already stored), ${details} detail pages`);
    return { listings, errors, fetched: seen.size };
  },
};
