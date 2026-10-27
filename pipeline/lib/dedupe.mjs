// Two-pass dedupe.
//   Pass 1: exact source id. Records that share any platform:sourceId are
//           the same event.
//   Pass 2: normalised title + organiser + start date. Titles are compared
//           without case, punctuation, years or edition numbers ("SpartaHack
//           12" on Devpost is "SpartaHack" on MLH). Start dates may differ by one
//           day (sources store the same moment in different time zones).
//           Organisers must match when both records state one; many feeds
//           (MLH, Hack Club, Devfolio) do not, so a missing organiser does
//           not block a match. Two records in different countries never
//           match.
// Merged events keep every source. Facts come from the highest priority
// source that states them (config.SOURCE_PRIORITY).
import { SOURCE_PRIORITY } from '../config.mjs';
import { daysBetween, dayKey, isDateOnly } from './dates.mjs';
import { sourceKey } from './record.mjs';
import { editionlessTitle, normOrganiser } from './text.mjs';

class UnionFind {
  constructor(n) { this.p = Array.from({ length: n }, (_, i) => i); }
  find(i) { while (this.p[i] !== i) { this.p[i] = this.p[this.p[i]]; i = this.p[i]; } return i; }
  union(a, b) { const ra = this.find(a); const rb = this.find(b); if (ra !== rb) this.p[Math.max(ra, rb)] = Math.min(ra, rb); return ra !== rb; }
}

export function pass2Match(a, b) {
  if (!a.title || !b.title) return false;
  const ta = editionlessTitle(a.title);
  if (!ta || ta !== editionlessTitle(b.title)) return false;
  const da = dayKey(a.startDate);
  const db = dayKey(b.startDate);
  if (!da || !db || Math.abs(daysBetween(da, db)) > 1) return false;
  const oa = normOrganiser(a.organiser);
  const ob = normOrganiser(b.organiser);
  if (oa && ob && oa !== ob) return false;
  if (a.countryCode && b.countryCode && a.countryCode !== b.countryCode) return false;
  return true;
}

const priority = (r) => {
  const i = SOURCE_PRIORITY.indexOf(r.applyPlatform || r.sources?.[0]?.platform);
  return i === -1 ? 99 : i;
};

const FACT_FIELDS = [
  'title', 'organiser', 'series', 'startDate', 'endDate', 'registrationDeadline', 'deadlineKind',
  'timezone', 'mode', 'city', 'country', 'countryCode', 'locationText', 'prizeText', 'eligibilityText', 'eligibility', 'teamSizeText',
];

// Pick the more precise of two values for the same moment: an exact time
// beats a date-only value within a day of it (sources list local days, so
// the UTC day of the exact time can differ by one).
export function preferPrecise(a, b) {
  if (a && b && isDateOnly(a) && !isDateOnly(b) && Math.abs(daysBetween(dayKey(a), dayKey(b))) <= 1) return b;
  return a ?? b;
}

export function mergeRecords(records) {
  const sorted = [...records].sort((x, y) => priority(x) - priority(y));
  const base = { ...sorted[0] };
  for (const f of FACT_FIELDS) {
    let v = null;
    for (const r of sorted) {
      if (r[f] != null && r[f] !== '') { v = r[f]; break; }
    }
    base[f] = v;
  }
  // Location fields travel together, from the top record, filling a missing
  // place from the next record that has one.
  const top = sorted[0];
  base.mode = top.mode;
  base.city = top.city;
  base.country = top.country;
  base.countryCode = top.countryCode;
  base.locationText = top.locationText ?? null;
  if (base.mode !== 'online' && !base.countryCode) {
    const placed = sorted.find((r) => r.mode !== 'online' && r.countryCode);
    if (placed) Object.assign(base, { city: placed.city, country: placed.country, countryCode: placed.countryCode });
  }
  // Deadline kind must travel with the deadline it describes.
  const deadlineOwner = sorted.find((r) => r.registrationDeadline);
  if (deadlineOwner) {
    // Only a deadline of the same kind may sharpen the owner's value.
    base.registrationDeadline = sorted
      .filter((r) => r.deadlineKind === deadlineOwner.deadlineKind)
      .reduce((acc, r) => preferPrecise(acc, r.registrationDeadline), deadlineOwner.registrationDeadline);
    base.deadlineKind = deadlineOwner.deadlineKind;
  }
  const applyOwner = sorted.find((r) => r.applyUrl);
  if (applyOwner) {
    base.applyUrl = applyOwner.applyUrl;
    base.applyPlatform = applyOwner.applyPlatform;
  }
  const seenSources = new Set();
  base.sources = [];
  for (const r of sorted) {
    for (const s of r.sources) {
      const k = sourceKey(s);
      if (seenSources.has(k)) continue;
      seenSources.add(k);
      base.sources.push(s);
    }
  }
  const niches = [];
  for (const r of sorted) for (const n of r.niches || []) if (!niches.includes(n)) niches.push(n);
  const specific = niches.filter((n) => n !== 'Open');
  base.niches = (specific.length ? specific : niches).slice(0, 3);
  base.lastCheckedAt = sorted.map((r) => r.lastCheckedAt).filter(Boolean).sort().pop() || base.lastCheckedAt;
  const warnings = sorted.flatMap((r) => r.warnings || []);
  if (warnings.length) base.warnings = [...new Set(warnings)];
  else delete base.warnings;
  return base;
}

// records: array of { record, sourceText }. Returns merged items plus a log
// of every merge for the run report.
export function dedupe(items) {
  const uf = new UnionFind(items.length);
  const merges = [];
  // Pass 1: exact source id.
  const byKey = new Map();
  items.forEach((it, i) => {
    for (const s of it.record.sources) {
      const k = sourceKey(s);
      if (byKey.has(k)) {
        if (uf.union(byKey.get(k), i)) merges.push({ pass: 1, reason: `same source id ${k}`, a: byKey.get(k), b: i });
      } else byKey.set(k, i);
    }
  });
  // Pass 2: normalised title + organiser + start date. Bucket by title.
  const byTitle = new Map();
  items.forEach((it, i) => {
    const t = editionlessTitle(it.record.title);
    if (!byTitle.has(t)) byTitle.set(t, []);
    byTitle.get(t).push(i);
  });
  for (const idxs of byTitle.values()) {
    for (let x = 0; x < idxs.length; x++) {
      for (let y = x + 1; y < idxs.length; y++) {
        const a = items[idxs[x]].record;
        const b = items[idxs[y]].record;
        if (uf.find(idxs[x]) === uf.find(idxs[y])) continue;
        if (pass2Match(a, b) && uf.union(idxs[x], idxs[y])) {
          merges.push({ pass: 2, reason: `title "${editionlessTitle(a.title)}" + organiser ${a.organiser || b.organiser ? `"${a.organiser || b.organiser}"` : '(not stated)'} + start ${dayKey(a.startDate)} / ${dayKey(b.startDate)}`, a: idxs[x], b: idxs[y] });
        }
      }
    }
  }
  const groups = new Map();
  items.forEach((it, i) => {
    const root = uf.find(i);
    if (!groups.has(root)) groups.set(root, []);
    groups.get(root).push(it);
  });
  const merged = [];
  for (const members of groups.values()) {
    const record = members.length === 1 ? members[0].record : mergeRecords(members.map((m) => m.record));
    // Stable order so the facts hash does not change between runs.
    const sourceText = [...members]
      .sort((x, y) => sourceKey(x.record.sources[0]).localeCompare(sourceKey(y.record.sources[0])))
      .map((m) => m.sourceText).filter(Boolean).join('\n');
    const sourceTexts = Object.fromEntries(members.flatMap((m) => m.record.sources.slice(0, 1).map((s) => [sourceKey(s), m.sourceText || ''])));
    merged.push({ record, sourceText, sourceTexts, memberCount: members.length });
  }
  const describe = (i) => ({ title: items[i].record.title, source: sourceKey(items[i].record.sources[0]), organiser: items[i].record.organiser, startDate: items[i].record.startDate });
  return { merged, merges: merges.map((m) => ({ pass: m.pass, reason: m.reason, a: describe(m.a), b: describe(m.b) })) };
}
