// Unstop: public JSON at unstop.com/api/public (allowed by its robots.txt).
// Unstop only answers a regular browser user agent, so every request here
// sends one; robots.txt is still checked for our bot token first.
//   List:   /api/public/opportunity/search-result?opportunity=hackathons
//           oppstatus=open   registration open
//           oppstatus=closed registration closed, event not over yet
//   Detail: /api/public/competition/<id>  (the list has no start date)
// Unstop's "expired" list is not sorted by date, so recently ended events
// are not back-filled; events enter the store while open and stay forever.
import { HTTP } from '../config.mjs';

const BASE = 'https://unstop.com';
const LIST = `${BASE}/api/public/opportunity/search-result`;
const PER_PAGE = 15;
const MAX_PAGES = 30;
const headers = { 'user-agent': HTTP.browserUserAgent, accept: 'application/json' };

// Unstop lists capture the flag, bug bounty and quiz events among its
// hackathons. They stay on the site, typed as competitions.
const COMPETITION = /\b(ctf|capture\s+the\s+flag|bug\s+bounty|quiz)\b/i;

const CURRENCY_ICON = { 'fa-rupee': 'INR', 'fa-inr': 'INR', 'fa-dollar': 'USD', 'fa-usd': 'USD', 'fa-euro': 'EUR', 'fa-eur': 'EUR', 'fa-gbp': 'GBP' };

export function formatUnstopPrizes(prizes) {
  if (!Array.isArray(prizes) || !prizes.length) return null;
  const parts = [];
  for (const p of prizes) {
    const rank = String(p.rank || '').trim() || 'Prize';
    const cash = Number(p.cash);
    const currency = p.currencyCode || CURRENCY_ICON[p.currency] || '';
    const money = cash > 0 ? `${currency ? `${currency} ` : ''}${cash.toLocaleString('en-US', { maximumFractionDigits: 2 })}${p.cash_postfix ? ` ${String(p.cash_postfix).trim()}` : ''}` : null;
    const others = String(p.others || '').trim();
    const what = [money, others].filter(Boolean).join(' + ');
    if (what) parts.push(`${rank}: ${what}`);
  }
  return parts.length ? parts.join('; ') : null;
}

const MODE = { online: 'online', offline: 'in-person', hybrid: 'hybrid', india: 'in-person' };

// Unstop's stated end_date can fall before the last round (for example an
// in-person final after the online round closes). The event ends when its
// last stated round ends.
export function latestEnd(it, detail) {
  const ends = [it.end_date, detail?.end_date, ...(detail?.rounds || []).flatMap((r) => (r.details || []).map((d) => d.end_date))]
    .filter(Boolean)
    .filter((v) => !Number.isNaN(Date.parse(v)));
  return ends.sort((a, b) => Date.parse(b) - Date.parse(a))[0] || null;
}

export function toListing(it, detail) {
  const url = it.seo_url || `${BASE}/${it.public_url}`;
  const addr = it.address_with_country_logo || {};
  const regn = it.regnRequirements || {};
  const eligible = (it.filters || []).filter((f) => f.type === 'eligible').map((f) => String(f.name).trim()).filter(Boolean);
  const min = Number(regn.min_team_size);
  const max = Number(regn.max_team_size);
  let teamSizeText = null;
  if (max > 0) teamSizeText = max === 1 ? '1 member (individual)' : min > 0 && min !== max ? `${min} to ${max} members` : `Up to ${max} members`;
  const mode = MODE[it.region];
  if (!mode) throw new Error(`unstop:${it.id}: unknown region "${it.region}"`);
  if (!detail?.start_date) throw new Error(`unstop:${it.id}: no start date in detail`);
  return {
    platform: 'unstop',
    sourceId: it.id,
    url,
    applyUrl: url,
    type: COMPETITION.test(it.title) ? 'competition' : 'hackathon',
    title: it.title,
    organiser: it.organisation?.name || null,
    startDate: detail.start_date,
    endDate: latestEnd(it, detail),
    registrationDeadline: regn.end_regn_dt || null,
    deadlineKind: 'registration',
    mode,
    city: mode === 'online' ? null : addr.city || null,
    country: mode === 'online' ? null : addr.country?.name || addr.country_code || null,
    prizeText: formatUnstopPrizes(it.prizes),
    themes: [
      ...(it.filters || []).filter((f) => f.type === 'category').map((f) => f.name),
      ...(it.workfunction || []).map((w) => w.name),
    ],
    eligibilityText: eligible.length ? eligible.join(', ') : null,
    // Unstop's "All" eligibility tag means anyone can apply.
    eligibility: eligible.some((n) => /^all$/i.test(n)) ? 'open' : undefined,
    teamSizeText,
    sourceText: it.details || '',
  };
}

async function fetchStatus(http, status) {
  const items = [];
  for (let page = 1; page <= MAX_PAGES; page++) {
    const data = await http.getJson(`${LIST}?opportunity=hackathons&oppstatus=${status}&page=${page}&per_page=${PER_PAGE}`, { headers });
    const d = data?.data || {};
    items.push(...(d.data || []));
    if (!d.data?.length || page >= (d.last_page || 1)) break;
  }
  return items;
}

export default {
  platform: 'unstop',
  async fetch({ http, log }) {
    const open = await fetchStatus(http, 'open');
    const closed = await fetchStatus(http, 'closed');
    const listings = [];
    const errors = [];
    const seen = new Set();
    for (const it of [...open, ...closed]) {
      if (seen.has(it.id)) continue;
      seen.add(it.id);
      try {
        const res = await http.getJson(`${BASE}/api/public/competition/${it.id}`, { headers });
        listings.push(toListing(it, res?.data?.competition));
      } catch (err) {
        errors.push(`unstop:${it.id}: ${err.message}`);
      }
    }
    log(`unstop: ${open.length} with registration open, ${closed.length} with registration closed, ${seen.size} detail pages`);
    return { listings, errors, fetched: seen.size };
  },
};
