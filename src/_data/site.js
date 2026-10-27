// Everything the templates need, derived from the pipeline's output
// (data/events.json and data/health/latest.json). Status is recomputed at
// build time so a page built later than the pipeline run is still right.
import fs from 'node:fs';
import { IDEAS, NICHES, PATHS, PLATFORMS, QUALITY_FLOOR, SITE } from '../../pipeline/config.mjs';
import { computeStatus, deadlineState } from '../../pipeline/lib/status.mjs';
import { dayKey, toInstant } from '../../pipeline/lib/dates.mjs';
import { ELIGIBILITY_LABELS } from '../../pipeline/lib/eligibility.mjs';
import { nicheSlug } from '../../pipeline/lib/niches.mjs';
import { slugify } from '../../pipeline/lib/text.mjs';
import { suggestGuideKeys } from '../_lib/suggest.js';
import { decorateIdea, matchIdeas } from '../_lib/ideas.js';
import { allIdeas, DIFFICULTIES, DIFFICULTY_LABELS } from '../../pipeline/lib/ideas.mjs';
import guidesData from './guides.js';

function readJson(file, fallback) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return fallback; }
}

// Start month in the event's own time zone when stated, so month pages agree
// with the dates shown on the event page.
function monthOf(e) {
  if (e.timezone && !/^\d{4}-\d{2}-\d{2}$/.test(e.startDate)) {
    try {
      const p = new Intl.DateTimeFormat('en-US', { timeZone: e.timezone, year: 'numeric', month: '2-digit' }).formatToParts(new Date(e.startDate));
      return `${p.find((x) => x.type === 'year').value}-${p.find((x) => x.type === 'month').value}`;
    } catch { /* unknown zone: fall back to UTC */ }
  }
  return dayKey(e.startDate).slice(0, 7);
}

const MONTH_NAMES = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

function shortPrize(p) {
  if (!p) return null;
  if (p.length <= 60) return p;
  const first = p.split(';')[0].trim();
  return first.length <= 60 ? `${first}; more on page` : 'Prizes listed on page';
}

// Sort key for "sorted by deadline": open deadlines first (soonest first),
// then events with no stated deadline (by start), then passed deadlines.
function deadlineSort(now) {
  return (a, b) => {
    const dl = (e) => toInstant(e.registrationDeadline, { endOfDay: true, tz: e.timezone });
    const g = (e) => (!e.registrationDeadline ? 1 : dl(e) < now ? 2 : 0);
    const ga = g(a);
    const gb = g(b);
    if (ga !== gb) return ga - gb;
    const ka = ga === 0 ? dl(a) : toInstant(a.startDate, { tz: a.timezone });
    const kb = gb === 0 ? dl(b) : toInstant(b.startDate, { tz: b.timezone });
    return ka - kb || a.title.localeCompare(b.title);
  };
}

const MODE_SCHEMA = {
  online: 'https://schema.org/OnlineEventAttendanceMode',
  'in-person': 'https://schema.org/OfflineEventAttendanceMode',
  hybrid: 'https://schema.org/MixedEventAttendanceMode',
};

function eventJsonLd(e) {
  const page = `${SITE.url}/hackathons/${e.slug}/`;
  const place = () => {
    const address = e.city || e.countryCode
      ? { '@type': 'PostalAddress', ...(e.city ? { addressLocality: e.city } : {}), ...(e.countryCode ? { addressCountry: e.countryCode } : {}) }
      : e.locationText || undefined;
    return { '@type': 'Place', name: e.locationText || [e.city, e.country].filter(Boolean).join(', ') || e.title, ...(address ? { address } : {}) };
  };
  const virtual = { '@type': 'VirtualLocation', url: e.applyUrl };
  const ld = {
    '@context': 'https://schema.org',
    '@type': 'Event',
    name: e.title,
    description: e.summary || undefined,
    startDate: e.startDate,
    endDate: e.endDate,
    eventStatus: 'https://schema.org/EventScheduled',
    eventAttendanceMode: MODE_SCHEMA[e.mode],
    location: e.mode === 'online' ? virtual : e.mode === 'hybrid' ? [place(), virtual] : place(),
    url: page,
    sameAs: e.sources.map((s) => s.url).filter(Boolean),
  };
  if (e.organiser) ld.organizer = { '@type': 'Organization', name: e.organiser };
  return JSON.parse(JSON.stringify(ld));
}

export default function () {
  const now = new Date();
  const store = readJson(PATHS.store, { events: [], redirects: {} });
  const winners = readJson(PATHS.winners, { events: {} }).events || {};
  const guides = guidesData();
  const health = readJson(PATHS.healthLatest, { sources: {} });
  // Idea cards: hand-written seed cards, then generated ones (newest first).
  const seedIdeas = readJson(PATHS.ideasSeed, { ideas: [] });
  const generatedIdeas = readJson(PATHS.ideasGenerated, { ideas: [] });
  const ideas = allIdeas(seedIdeas, generatedIdeas).map(decorateIdea);

  const all = store.events.filter((e) => e.published !== false);
  for (const e of all) {
    e.status = computeStatus(e, now);
    e.deadlineState = deadlineState(e, now);
    e.platformNames = [...new Set(e.sources.map((s) => PLATFORMS[s.platform]?.name || s.platform))];
    e.applyName = PLATFORMS[e.applyPlatform]?.name || e.applyPlatform;
    e.sourceLinks = e.sources.map((s) => ({ name: PLATFORMS[s.platform]?.name || s.platform, url: s.url }));
    e.nicheLinks = e.niches.map((n) => ({ name: n, slug: nicheSlug(n) }));
    e.countrySlug = e.country ? slugify(e.country) : null;
    e.seriesSlug = e.series ? slugify(e.series) : null;
    e.monthKey = monthOf(e);
    e.eligibilityLabel = e.eligibility ? ELIGIBILITY_LABELS[e.eligibility] : null;
    e.type = e.type || 'hackathon';
    // Organiser fields (set by hand when a listing is claimed).
    e.featured = e.featured === true;
    e.claimedBy = e.claimedBy || '';
    // Winners come from the weekly winners pipeline (data/winners.json).
    const w = winners[e.slug];
    e.winnersStatus = w?.winnersStatus || null;
    e.winners = w?.winnersStatus === 'published' ? w.winners : [];
    e.winnersCheckedAt = w?.checkedAt || null;
    e.winnersSourceName = w?.source ? PLATFORMS[w.source]?.name || w.source : null;
    e.winnersSourceUrl = w?.sourceUrl || null;
    e.winnersChecked = (w?.checked || []).map((p) => PLATFORMS[p]?.name || p);
    // Suggested how-tos: a "Prepare" block before and during, "Reflect" after.
    const sg = suggestGuideKeys(e, now);
    e.suggested = { block: sg.block, guides: sg.keys.map((k) => guides.byKey[k]).filter(Boolean) };
    e.compact = {
      slug: e.slug,
      type: e.type,
      title: e.title,
      organiser: e.organiser,
      status: e.status,
      mode: e.mode,
      niches: e.niches,
      country: e.country,
      countryCode: e.countryCode,
      city: e.city,
      locationText: e.city || e.country ? null : e.locationText,
      deadline: e.registrationDeadline,
      deadlineKind: e.deadlineKind,
      start: e.startDate,
      end: e.endDate,
      tz: e.timezone,
      platforms: e.platformNames,
      platformKeys: [...new Set(e.sources.map((s) => s.platform))],
      prize: shortPrize(e.prizeText),
    };
  }
  for (const e of all) e.jsonld = eventJsonLd(e);
  const ideaMatches = matchIdeas(all, ideas, { limit: IDEAS.perEvent });
  for (const e of all) e.ideaStarters = ideaMatches.get(e.slug) || [];
  // Feed order: newest cards first, then by title.
  const ideaFeed = [...ideas].sort((a, b) => b.source.date.localeCompare(a.source.date) || a.title.localeCompare(b.title));
  const byDeadline = deadlineSort(now);
  const open = all.filter((e) => e.status !== 'ended').sort(byDeadline);
  const ended = all.filter((e) => e.status === 'ended').sort((a, b) => toInstant(b.endDate, { endOfDay: true }) - toInstant(a.endDate, { endOfDay: true }));
  const week = new Date(now.getTime() + 7 * 86_400_000);
  const closingSoon = open.filter((e) => {
    if (!e.registrationDeadline) return false;
    const d = toInstant(e.registrationDeadline, { endOfDay: true, tz: e.timezone });
    return d >= now && d <= week;
  });

  // Niches: every niche gets a page, even when empty today.
  const niches = NICHES.map((name) => {
    const events = all.filter((e) => e.niches.includes(name));
    return {
      name,
      slug: nicheSlug(name),
      open: events.filter((e) => e.status !== 'ended').sort(byDeadline),
      ended: events.filter((e) => e.status === 'ended').sort((a, b) => toInstant(b.endDate) - toInstant(a.endDate)),
      openCount: events.filter((e) => e.status !== 'ended').length,
      total: events.length,
    };
  });

  const group = (keyFn, labelFn) => {
    const m = new Map();
    for (const e of all) {
      const k = keyFn(e);
      if (!k) continue;
      if (!m.has(k)) m.set(k, { key: k, label: labelFn(e), events: [] });
      m.get(k).events.push(e);
    }
    return [...m.values()].map((g) => ({
      ...g,
      open: g.events.filter((e) => e.status !== 'ended').sort(byDeadline),
      ended: g.events.filter((e) => e.status === 'ended').sort((a, b) => toInstant(b.endDate) - toInstant(a.endDate)),
      openCount: g.events.filter((e) => e.status !== 'ended').length,
    }));
  };

  const countries = group((e) => e.countrySlug, (e) => e.country)
    .map((g) => ({ ...g, slug: g.key, name: g.label, code: g.events[0].countryCode }))
    .sort((a, b) => b.openCount - a.openCount || a.name.localeCompare(b.name));

  const months = group((e) => e.monthKey, (e) => {
    const [y, m] = e.monthKey.split('-');
    return `${MONTH_NAMES[Number(m) - 1]} ${y}`;
  })
    .map((g) => ({ ...g, slug: g.key, name: g.label, all: [...g.events].sort((a, b) => toInstant(a.startDate) - toInstant(b.startDate)) }))
    .sort((a, b) => b.key.localeCompare(a.key));

  const series = group((e) => e.seriesSlug, (e) => e.series)
    .map((g) => ({ ...g, slug: g.key, name: g.label, all: [...g.events].sort((a, b) => toInstant(b.startDate) - toInstant(a.startDate)) }))
    .sort((a, b) => a.name.localeCompare(b.name));

  const sources = Object.entries(PLATFORMS).map(([key, p]) => {
    const h = health.sources?.[key] || {};
    return {
      key,
      ...p,
      ok: h.ok ?? null,
      skipped: Boolean(h.skipped),
      skipReason: h.skipped ? h.reason : null,
      lastSuccessAt: h.lastSuccessAt || null,
      lastCount: h.normalised ?? null,
      lastSuccessCount: h.lastSuccessCount ?? null,
      errorCount: h.errorCount ?? 0,
      fetched: h.fetched ?? null,
      lastError: h.ok === false ? h.errors?.[0] : null,
      inStore: all.filter((e) => e.sources.some((s) => s.platform === key)).length,
    };
  });

  const countryOptions = countries.filter((c) => c.events.length).map((c) => ({ code: c.code, name: c.name, count: c.openCount }));
  const platformOptions = sources.filter((s) => s.inStore).map((s) => ({ key: s.key, name: s.name }));

  return {
    ...SITE,
    now: now.toISOString(),
    buildDate: now.toISOString().slice(0, 10),
    qualityFloor: QUALITY_FLOOR,
    all,
    withDeadline: all.filter((e) => e.registrationDeadline),
    // Calendar feeds: everything not ended, plus events that ended in the
    // last 90 days so subscribers keep recent history.
    feedEvents: all.filter((e) => e.status !== 'ended' || toInstant(e.endDate, { endOfDay: true }) > new Date(now.getTime() - 90 * 86_400_000)),
    open,
    ended,
    closingSoon,
    niches,
    countries,
    months,
    series,
    sources,
    health,
    countryOptions,
    platformOptions,
    feeds: [
      { slug: 'all', name: 'All hackathons', niche: null },
      ...niches.map((n) => ({ slug: n.slug, name: `${n.name} hackathons`, niche: n.name, count: n.openCount })),
    ],
    redirects: Object.entries(store.redirects || {}).map(([from, to]) => ({ from, to })),
    ideas: ideaFeed,
    ideaNiches: NICHES.map((name) => ({ name, slug: nicheSlug(name), count: ideas.filter((i) => i.niches.includes(name)).length })),
    ideaDifficulties: DIFFICULTIES.map((key) => ({ key, label: DIFFICULTY_LABELS[key], count: ideas.filter((i) => i.difficulty === key).length })),
    // Claim form endpoint (for example a Formspree form URL), set at build time.
    claimFormEndpoint: process.env.CLAIM_FORM_ENDPOINT || '',
    counts: {
      total: all.length,
      open: open.length,
      upcoming: all.filter((e) => e.status === 'upcoming').length,
      live: all.filter((e) => e.status === 'live').length,
      ended: ended.length,
      closingSoon: closingSoon.length,
      withWinners: all.filter((e) => e.winnersStatus === 'published').length,
      winnersNotPublished: all.filter((e) => e.winnersStatus === 'not published').length,
      placeholders: all.filter((e) => e.descriptionStatus === 'placeholder' || e.descriptionStatus === 'review').length,
      indexable: all.filter((e) => e.indexable).length,
      ideas: ideas.length,
      seedIdeas: ideas.filter((i) => i.source.kind === 'seed').length,
      generatedIdeas: ideas.filter((i) => i.source.kind === 'generated').length,
      eventsWithIdeas: all.filter((e) => e.ideaStarters.length).length,
    },
  };
}
