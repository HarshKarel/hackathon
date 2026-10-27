// The permanent event store (data/events.json). Every event gets one slug the
// first time it is seen and keeps it forever. Events that drop out of their
// feeds stay in the store; their status moves on with the calendar. If two
// stored pages later turn out to be the same event, the newer one becomes a
// redirect to the older one, so no URL ever breaks.
import fs from 'node:fs';
import { PATHS, SOURCE_PRIORITY } from '../config.mjs';
import { dayKey, toInstant } from './dates.mjs';
import { mergeRecords, pass2Match, preferPrecise } from './dedupe.mjs';
import { sourceKey } from './record.mjs';
import { computeStatus } from './status.mjs';
import { slugify } from './text.mjs';

export function loadStore(file = PATHS.store) {
  if (!fs.existsSync(file)) return { events: new Map(), redirects: {} };
  const data = JSON.parse(fs.readFileSync(file, 'utf8'));
  return {
    events: new Map((data.events || []).map((e) => [e.slug, e])),
    redirects: data.redirects || {},
  };
}

export function saveStore(store, now, file = PATHS.store) {
  const events = [...store.events.values()].sort((a, b) => a.slug.localeCompare(b.slug));
  const data = {
    schema: 'hackathon.so events v1 (see docs/RECORD_FORMAT.md)',
    updatedAt: now.toISOString(),
    count: events.length,
    events,
    redirects: store.redirects,
  };
  fs.writeFileSync(file, JSON.stringify(data, null, 1) + '\n');
}

export function makeSlug(record, taken) {
  const year = dayKey(record.startDate).slice(0, 4);
  let base = slugify(record.title) || 'hackathon';
  if (!base.includes(year)) base = `${base}-${year}`;
  let slug = base;
  for (let i = 2; taken.has(slug); i++) slug = `${base}-${i}`;
  return slug;
}

// Organiser fields. Set by hand (never by a source) when an organiser claims
// a listing; no source update ever changes them.
//   featured   true to feature the listing (no payments or dashboard yet)
//   claimedBy  who claimed it, for example "Jane Doe, Example University"
export const ORGANISER_DEFAULTS = Object.freeze({ featured: false, claimedBy: '' });

export function withOrganiserDefaults(e) {
  if (typeof e.featured !== 'boolean') e.featured = false;
  if (typeof e.claimedBy !== 'string') e.claimedBy = '';
  return e;
}

const FACT_FIELDS = [
  'type', 'title', 'organiser', 'series', 'applyUrl', 'applyPlatform', 'startDate', 'endDate', 'registrationDeadline', 'deadlineKind',
  'timezone', 'mode', 'city', 'country', 'countryCode', 'locationText', 'prizeText', 'niches', 'eligibilityText', 'eligibility', 'teamSizeText',
];

// Union of two source lists, in source priority order (stable), so the list
// and anything hashed from it do not depend on which listing arrived first.
function mergeSources(a, b) {
  const seen = new Set(a.map(sourceKey));
  const all = [...a, ...b.filter((s) => !seen.has(sourceKey(s)))];
  return all.map((s, i) => [s, i]).sort((x, y) => rankOf(x[0].platform) - rankOf(y[0].platform) || x[1] - y[1]).map(([s]) => s);
}

const rank = (p) => {
  const i = SOURCE_PRIORITY.indexOf(p);
  return i === -1 ? 99 : i;
};
function rankOf(p) { return rank(p); }
const isEmpty = (v) => v == null || v === '' || (Array.isArray(v) && !v.length);

// Fold a fresh record into the stored one.
// - Fresh facts win, unless this run only saw lower-priority sources than the
//   one that supplied the stored facts (e.g. an ended Devpost event that is
//   not re-read, merged with its MLH listing): then fresh data only fills gaps.
// - A fresh null never erases a stored fact (a failed fetch must not blank a page).
export function updateStored(stored, fresh) {
  const out = { ...stored };
  const weaker = rank(fresh.applyPlatform) > rank(stored.applyPlatform);
  const LOC = ['city', 'country', 'countryCode', 'locationText'];
  for (const f of FACT_FIELDS) {
    if (LOC.includes(f) || isEmpty(fresh[f])) continue;
    if (weaker && !isEmpty(stored[f])) continue;
    out[f] = fresh[f];
  }
  if (!weaker) {
    // A day-only value never replaces an exact time for the same moment.
    for (const f of ['startDate', 'endDate', 'registrationDeadline']) {
      if (fresh[f] && stored[f]) out[f] = preferPrecise(fresh[f], stored[f]);
    }
    // A series stated by a source replaces one derived from titles.
    if (fresh.series) delete out.seriesDerived;
  }
  // Location moves as one group: never a city from one listing with a
  // country from another.
  const storedHasPlace = stored.mode !== 'online' && (stored.countryCode || stored.city || stored.locationText);
  if (weaker) {
    if (!storedHasPlace && stored.mode !== 'online') for (const f of LOC) out[f] = fresh[f] ?? null;
  } else if (fresh.mode === 'online') {
    for (const f of LOC) out[f] = null;
  } else if (fresh.countryCode || (!stored.countryCode && (fresh.city || fresh.locationText)) || stored.mode === 'online') {
    for (const f of LOC) out[f] = fresh[f] ?? null;
  }
  out.sources = mergeSources(fresh.sources, stored.sources);
  out.lastCheckedAt = fresh.lastCheckedAt;
  if (fresh.warnings) out.warnings = fresh.warnings;
  else if (!weaker) delete out.warnings;
  return out;
}

export function integrate(store, merged, { now, endedCutoff }) {
  const index = new Map();
  for (const e of store.events.values()) for (const s of e.sources) index.set(sourceKey(s), e.slug);
  const taken = new Set([...store.events.keys(), ...Object.keys(store.redirects)]);
  const result = { added: [], updated: [], skippedOld: 0, absorbed: [], seen: new Map() };

  // 1. Find the stored page(s) each fresh event belongs to.
  const found = merged.map((item) => {
    const rec = item.record;
    let slugs = [...new Set(rec.sources.map((s) => index.get(sourceKey(s))).filter(Boolean))];
    let matchedBy = slugs.length ? 1 : 0;
    if (!slugs.length) {
      for (const e of store.events.values()) {
        if (pass2Match(rec, e)) { slugs = [e.slug]; matchedBy = 2; break; }
      }
    }
    return { item, slugs, matchedBy };
  });

  // 2. Fresh events that land on the same stored page are merged first, by
  //    source priority, so arrival order never decides a fact.
  const groups = [];
  const groupOfSlug = new Map();
  for (const f of found) {
    if (!f.slugs.length) { groups.push([f]); continue; }
    const existing = f.slugs.map((s) => groupOfSlug.get(s)).find(Boolean);
    const g = existing || [];
    if (!existing) groups.push(g);
    g.push(f);
    for (const s of f.slugs) groupOfSlug.set(s, g);
  }

  for (const g of groups) {
    const slugs = [...new Set(g.flatMap((f) => f.slugs))];
    const rec = g.length === 1 ? g[0].item.record : mergeRecords(g.map((f) => f.item.record));
    const sourceText = g.map((f) => f.item.sourceText).filter(Boolean).sort().join('\n');
    const item = { ...g[0].item, record: rec, sourceText };
    if (slugs.length) {
      // Keep a page that is already published, then the one seen first;
      // the others redirect to it so their URLs never break.
      const ev = (s) => store.events.get(s);
      slugs.sort((a, b) => (ev(a).publishedAt ? 0 : 1) - (ev(b).publishedAt ? 0 : 1)
        || (ev(a).firstSeenAt || '').localeCompare(ev(b).firstSeenAt || '') || a.localeCompare(b));
      const keep = slugs[0];
      let target = ev(keep);
      for (const other of slugs.slice(1)) {
        const o = ev(other);
        const earliest = (x, y) => [x, y].filter(Boolean).sort()[0];
        target = {
          ...target,
          sources: mergeSources(target.sources, o.sources),
          firstSeenAt: earliest(target.firstSeenAt, o.firstSeenAt),
          publishedAt: earliest(target.publishedAt, o.publishedAt),
          // Organiser fields survive a merge from either page.
          featured: target.featured === true || o.featured === true,
          claimedBy: target.claimedBy || o.claimedBy || '',
        };
        store.events.delete(other);
        store.redirects[other] = keep;
        result.absorbed.push({ from: other, into: keep });
      }
      const updated = updateStored(target, rec);
      store.events.set(keep, updated);
      for (const s of updated.sources) index.set(sourceKey(s), keep);
      result.updated.push({ slug: keep, matchedBy: Math.min(...g.map((f) => f.matchedBy || 9)) });
      result.seen.set(keep, item);
      continue;
    }
    // New event. Old ended events are not back-filled, except curated seeds.
    const curated = rec.sources.some((s) => s.platform === 'seed');
    if (!curated && computeStatus(rec, now) === 'ended' && toInstant(rec.endDate, { endOfDay: true, tz: rec.timezone }) < endedCutoff) {
      result.skippedOld += 1;
      continue;
    }
    const slug = makeSlug(rec, taken);
    taken.add(slug);
    const created = { ...rec, slug, firstSeenAt: now.toISOString(), ...ORGANISER_DEFAULTS };
    store.events.set(slug, created);
    for (const s of created.sources) index.set(sourceKey(s), slug);
    result.added.push(slug);
    result.seen.set(slug, item);
  }
  // Chains of redirects always point at a live page.
  for (const [from, to] of Object.entries(store.redirects)) {
    let t = to;
    const guard = new Set([from]);
    while (store.redirects[t] && !guard.has(t)) { guard.add(t); t = store.redirects[t]; }
    store.redirects[from] = t;
  }
  return result;
}
