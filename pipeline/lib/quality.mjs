// qualityScore: five completeness checks, 20 points each (0 to 100).
// Pages under QUALITY_FLOOR are still built but carry noindex and are left
// out of the sitemap.
import { QUALITY_FLOOR } from '../config.mjs';

export const QUALITY_CHECKS = {
  dates: (e) => Boolean(e.startDate && e.endDate),
  deadline: (e) => Boolean(e.registrationDeadline),
  applyLink: (e) => /^https?:\/\//.test(e.applyUrl || ''),
  prize: (e) => Boolean(e.prizeText),
  // Only an approved original description counts. Placeholders do not.
  description: (e) => e.descriptionStatus === 'ai' || e.descriptionStatus === 'reviewed',
};

export function qualityScore(e) {
  let score = 0;
  const missing = [];
  for (const [name, check] of Object.entries(QUALITY_CHECKS)) {
    if (check(e)) score += 20;
    else missing.push(name);
  }
  return { score, missing, indexable: score >= QUALITY_FLOOR };
}
