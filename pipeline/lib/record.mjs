// The one normalised record every listing becomes. See docs/RECORD_FORMAT.md.
import { NICHES, PLATFORMS } from '../config.mjs';
import { toInstant, toStoredDate } from './dates.mjs';
import { countryName, toCountryCode, titleCaseCity } from './geo.mjs';
import { tagNiches } from './niches.mjs';
import { normaliseEligibility } from './eligibility.mjs';
import { cleanFact, plainText } from './text.mjs';

export const MODES = ['online', 'in-person', 'hybrid'];

// Only absolute http(s) links reach the site; anything else (javascript:,
// data:, relative paths) is dropped.
export function safeUrl(u) {
  if (!u) return null;
  try {
    const raw = String(u).trim();
    const url = new URL(raw);
    // Keep the link exactly as the source gave it; only the scheme is checked.
    return url.protocol === 'http:' || url.protocol === 'https:' ? raw : null;
  } catch {
    return null;
  }
}

export const ELIGIBILITY_VALUES = ['students', 'open', 'professionals', 'mixed'];

// Turn one adapter listing into a record. Returns { record, sourceText }.
// sourceText is the listing's own descriptive text: it is used for niche
// tagging, hashing and the copy check, and is never written to the site.
export function normaliseListing(listing, now = new Date()) {
  const platform = listing.platform;
  if (!PLATFORMS[platform]) throw new Error(`unknown platform ${platform}`);
  if (!listing.sourceId) throw new Error(`${platform}: listing without source id`);
  const title = cleanFact(listing.title);
  if (!title) throw new Error(`${platform}:${listing.sourceId}: listing without title`);

  const startDate = toStoredDate(listing.startDate);
  let endDate = toStoredDate(listing.endDate) || startDate;
  if (!startDate) throw new Error(`${platform}:${listing.sourceId}: listing without start date`);
  const warnings = [...(listing.warnings || [])];
  if (toInstant(endDate, { endOfDay: true }) < toInstant(startDate)) {
    warnings.push(`source end date ${endDate} is before start date; end set to start`);
    endDate = startDate;
  }

  const listingUrl = safeUrl(listing.url);
  const applyUrl = safeUrl(listing.applyUrl) || listingUrl;
  if (!applyUrl) throw new Error(`${platform}:${listing.sourceId}: no valid http(s) link to apply`);

  const mode = MODES.includes(listing.mode) ? listing.mode : null;
  if (!mode) throw new Error(`${platform}:${listing.sourceId}: unknown mode ${listing.mode}`);

  const countryCode = mode === 'online' && !listing.countryCode ? null : toCountryCode(listing.countryCode || listing.country);
  const sourceText = plainText([listing.tagline, listing.sourceText].filter(Boolean).join('\n'));
  const eligibilityText = cleanFact(listing.eligibilityText);
  const eligibility = ELIGIBILITY_VALUES.includes(listing.eligibility)
    ? listing.eligibility
    : normaliseEligibility(eligibilityText, { inviteOnly: listing.inviteOnly, defaultValue: listing.eligibilityDefault });

  const niches = Array.isArray(listing.niches) && listing.niches.length
    ? listing.niches.filter((n) => NICHES.includes(n)).slice(0, 3)
    : tagNiches({ title, themes: listing.themes || [], sourceText, platformDefaults: listing.platformNiches || [] });

  const record = {
    slug: null, // assigned by the store, then never changed
    title,
    organiser: cleanFact(listing.organiser),
    series: cleanFact(listing.series),
    sources: [
      { platform, sourceId: String(listing.sourceId), url: listingUrl || applyUrl },
      ...(listing.extraSources || []).map((s) => ({ platform: s.platform, sourceId: String(s.sourceId), url: safeUrl(s.url) })),
    ],
    applyUrl,
    applyPlatform: platform,
    startDate,
    endDate,
    registrationDeadline: toStoredDate(listing.registrationDeadline),
    deadlineKind: listing.registrationDeadline ? listing.deadlineKind || 'registration' : null,
    timezone: listing.timezone || null,
    mode,
    city: mode === 'online' ? null : titleCaseCity(cleanFact(listing.city)),
    // Location exactly as the source wrote it, when it is not a clean city
    // and country (often a venue name).
    locationText: mode === 'online' ? null : cleanFact(listing.locationText),
    country: countryName(countryCode),
    countryCode,
    prizeText: cleanFact(listing.prizeText),
    niches: niches.length ? niches : ['Open'],
    eligibilityText,
    eligibility,
    teamSizeText: cleanFact(listing.teamSizeText),
    lastCheckedAt: listing.lastCheckedAt ? new Date(listing.lastCheckedAt).toISOString() : now.toISOString(),
  };
  if (warnings.length) record.warnings = warnings;
  return { record, sourceText };
}

export const sourceKey = (s) => `${s.platform}:${s.sourceId}`;
