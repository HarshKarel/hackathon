// Idea starters for event pages.
//
// Each event shows up to IDEAS.perEvent cards that share at least one niche
// with it. Ranking, in order:
//   1. cards not already shown on an earlier edition of the same series
//   2. more niches in common
//   3. the card's main niche is one of the event's niches
//   4. a stable per-event shuffle, so similar events show different cards
//
// Ended events keep their ideas: a generated card is only considered for an
// ended event if it existed when the event ended, so cards added later never
// replace what the page showed. Seed cards are available to every event.
import { DIFFICULTY_LABELS, TEAM_SIZE_LABELS } from '../../pipeline/lib/ideas.mjs';
import { dayKey, toInstant } from '../../pipeline/lib/dates.mjs';
import { nicheSlug } from '../../pipeline/lib/niches.mjs';

// FNV-1a: a small, stable string hash for tie-breaking.
function hash(s) {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h;
}

export function availableFor(idea, e) {
  if (idea.source?.kind !== 'generated') return true;
  if (e.status !== 'ended') return true;
  return idea.source.date <= dayKey(e.endDate);
}

export function rankIdeas(e, ideas, { exclude = new Set(), limit = 3 } = {}) {
  const niches = new Set(e.niches || []);
  return ideas
    .filter((i) => availableFor(i, e))
    .map((i) => ({
      i,
      fresh: exclude.has(i.id) ? 0 : 1,
      overlap: i.niches.filter((n) => niches.has(n)).length,
      main: niches.has(i.niches[0]) ? 1 : 0,
      h: hash(`${e.slug}|${i.id}`),
    }))
    .filter((x) => x.overlap > 0)
    .sort((a, b) => b.fresh - a.fresh || b.overlap - a.overlap || b.main - a.main || a.h - b.h)
    .slice(0, limit)
    .map((x) => x.i);
}

// Returns Map(slug -> [idea, ...]). Editions of a series are matched in
// start-date order, each avoiding the cards already shown on earlier ones.
export function matchIdeas(events, ideas, { limit = 3 } = {}) {
  const out = new Map();
  const bySeries = new Map();
  for (const e of events) {
    if (!e.seriesSlug) {
      out.set(e.slug, rankIdeas(e, ideas, { limit }));
      continue;
    }
    if (!bySeries.has(e.seriesSlug)) bySeries.set(e.seriesSlug, []);
    bySeries.get(e.seriesSlug).push(e);
  }
  for (const editions of bySeries.values()) {
    editions.sort((a, b) => toInstant(a.startDate) - toInstant(b.startDate) || a.slug.localeCompare(b.slug));
    const shown = new Set();
    for (const e of editions) {
      const picks = rankIdeas(e, ideas, { exclude: shown, limit });
      for (const p of picks) shown.add(p.id);
      out.set(e.slug, picks);
    }
  }
  return out;
}

// Display fields for templates.
export function decorateIdea(i) {
  return {
    ...i,
    difficultyLabel: DIFFICULTY_LABELS[i.difficulty] || i.difficulty,
    teamSizeLabel: TEAM_SIZE_LABELS[i.teamSize] || i.teamSize,
    nicheLinks: i.niches.map((n) => ({ name: n, slug: nicheSlug(n) })),
    nicheSlugs: i.niches.map((n) => nicheSlug(n)).join(' '),
  };
}
