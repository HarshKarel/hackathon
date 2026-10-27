// Hand-maintained events from data/seed-events.json (see docs/SEED_FORMAT.md).
import fs from 'node:fs';
import { PATHS } from '../config.mjs';

export function toListing(e) {
  const sources = e.sources || [];
  const own = sources[0];
  if (!own || own.platform !== 'seed' || !own.sourceId) {
    throw new Error(`seed "${e.title}": first source must be { platform: "seed", sourceId }`);
  }
  for (const k of ['title', 'applyUrl', 'startDate', 'mode', 'lastCheckedAt']) {
    if (!e[k]) throw new Error(`seed "${e.title || own.sourceId}": missing ${k}`);
  }
  if (!Array.isArray(e.niches) || e.niches.length < 1 || e.niches.length > 3) {
    throw new Error(`seed "${e.title}": niches must list 1 to 3 values`);
  }
  return {
    platform: 'seed',
    sourceId: own.sourceId,
    url: own.url || e.applyUrl,
    extraSources: sources.slice(1),
    applyUrl: e.applyUrl,
    title: e.title,
    organiser: e.organiser,
    series: e.series,
    startDate: e.startDate,
    endDate: e.endDate,
    registrationDeadline: e.registrationDeadline,
    deadlineKind: e.deadlineKind,
    timezone: e.timezone,
    mode: e.mode,
    city: e.city,
    country: e.country,
    prizeText: e.prizeText,
    niches: e.niches,
    eligibilityText: e.eligibilityText,
    eligibility: e.eligibility,
    teamSizeText: e.teamSizeText,
    lastCheckedAt: e.lastCheckedAt,
    sourceText: '',
    keepWhenOld: true, // curated: ignore the ended-event window
  };
}

export default {
  platform: 'seed',
  async fetch({ log }) {
    const data = JSON.parse(fs.readFileSync(PATHS.seed, 'utf8'));
    const listings = [];
    const errors = [];
    for (const e of data.events || []) {
      try {
        listings.push(toListing(e));
      } catch (err) {
        errors.push(err.message);
      }
    }
    log(`seed: ${listings.length} curated events`);
    return { listings, errors, fetched: (data.events || []).length };
  },
};
