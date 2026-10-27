// Devfolio: public JSON API at api.devfolio.co. The list endpoint returns
// personal data (participant names, contact emails); we read only the event
// fields below and drop everything else here, inside the adapter.
import { DEVFOLIO_PRIZE_LIMIT } from '../config.mjs';
import { toInstant } from '../lib/dates.mjs';

const API = 'https://api.devfolio.co/api/hackathons';

export function formatPrizes(prizes) {
  if (!Array.isArray(prizes) || !prizes.length) return null;
  const parts = [];
  const sorted = [...prizes].sort((a, b) => Number(b.amount || 0) - Number(a.amount || 0));
  for (const p of sorted) {
    const amount = Number(p.amount);
    if (!p.name && !amount) continue;
    const money = amount > 0
      ? `${p.currency ? p.currency + ' ' : ''}${amount.toLocaleString('en-US', { maximumFractionDigits: 2 })}`
      : null;
    const qty = Number(p.quantity) > 1 ? ` (x${p.quantity})` : '';
    parts.push(money ? `${p.name || 'Prize'}: ${money}${qty}` : `${p.name}${qty}`);
  }
  return parts.length ? parts.join('; ') : null;
}

export function toListing(h, prizes = null) {
  const s = h.hackathon_setting || {};
  const sub = s.subdomain || h.slug;
  const url = `https://${sub}.devfolio.co/`;
  const mode = h.is_online ? 'online' : s.is_hybrid ? 'hybrid' : 'in-person';
  const teamMin = Number(h.team_min);
  const teamMax = Number(h.team_size);
  let teamSizeText = null;
  if (teamMax > 0) teamSizeText = teamMin > 0 && teamMin !== teamMax ? `${teamMin} to ${teamMax} per team` : `Up to ${teamMax} per team`;
  return {
    platform: 'devfolio',
    sourceId: h.uuid,
    url,
    applyUrl: url,
    title: h.name,
    organiser: h.hackathon_brand?.name || null,
    series: h.hackathon_brand?.name || null,
    startDate: h.starts_at,
    endDate: h.ends_at,
    registrationDeadline: s.reg_ends_at || null,
    deadlineKind: 'registration',
    timezone: h.timezone || null,
    mode,
    city: h.city || null,
    country: h.country || null,
    prizeText: formatPrizes(prizes),
    themes: (h.themes || []).map((t) => t.name),
    platformNiches: h.is_university_hackathon ? ['Student'] : [],
    eligibilityText: s.women_only ? 'Women only' : null,
    teamSizeText,
    tagline: h.tagline || '',
    sourceText: h.desc || '',
  };
}

async function fetchFilter(http, filter, { stopBefore, maxPages = 10 } = {}) {
  const items = [];
  for (let page = 1; page <= maxPages; page++) {
    const data = await http.getJson(`${API}?filter=${filter}&page=${page}&limit=50`);
    const batch = data.result || [];
    items.push(...batch);
    if (!batch.length || page >= (data.pages || 1)) break;
    if (stopBefore && batch.every((h) => toInstant(h.ends_at) < stopBefore)) break;
  }
  return items;
}

export default {
  platform: 'devfolio',
  async fetch({ http, endedCutoff, log }) {
    const open = await fetchFilter(http, 'application_open');
    const upcoming = await fetchFilter(http, 'upcoming');
    const past = await fetchFilter(http, 'past', { stopBefore: endedCutoff });
    const errors = [];
    const listings = [];
    const seen = new Set();
    let prizeCalls = 0;
    const activeIds = new Set([...open, ...upcoming].map((h) => h.uuid));
    for (const h of [...open, ...upcoming, ...past]) {
      if (seen.has(h.uuid)) continue;
      seen.add(h.uuid);
      if (h.private || (h.type && h.type !== 'HACKATHON') || h.fellowship) continue;
      let prizes = null;
      if (activeIds.has(h.uuid) && prizeCalls < DEVFOLIO_PRIZE_LIMIT) {
        prizeCalls += 1;
        try {
          prizes = await http.getJson(`${API}/${encodeURIComponent(h.slug)}/prizes`);
        } catch (err) {
          errors.push(`prizes ${h.slug}: ${err.message}`);
        }
      }
      try {
        listings.push(toListing(h, prizes));
      } catch (err) {
        errors.push(`devfolio:${h.uuid}: ${err.message}`);
      }
    }
    log(`devfolio: ${open.length} open, ${upcoming.length} upcoming, ${past.length} past read, ${prizeCalls} prize lists`);
    return { listings, errors, fetched: seen.size };
  },
};
