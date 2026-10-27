// Project idea cards: the record format, validation, near-duplicate checks
// and niche balance. Shared by the seed file checks, the weekly generator
// (pipeline/ideas.mjs) and the site.
//
// One card:
//   id          stable slug, unique across seed and generated cards
//   title       2 to 8 words
//   pitch       one line
//   whatItDoes  3 to 4 sentences; names the user, the core action and the demo moment
//   niches      1 to 3 from config.NICHES, most relevant first
//   stack       2 to 5 short items
//   difficulty  weekend-easy | weekend-medium | weekend-hard
//   teamSize    solo-friendly | pair | team
//   source      { kind: "seed" | "generated", date: "YYYY-MM-DD", ... }
import { IDEAS, NICHES } from '../config.mjs';
import { slugify, wordCount } from './text.mjs';

export const DIFFICULTIES = ['weekend-easy', 'weekend-medium', 'weekend-hard'];
export const TEAM_SIZES = ['solo-friendly', 'pair', 'team'];
export const DIFFICULTY_LABELS = { 'weekend-easy': 'Weekend-easy', 'weekend-medium': 'Weekend-medium', 'weekend-hard': 'Weekend-hard' };
export const TEAM_SIZE_LABELS = { 'solo-friendly': 'Solo friendly', pair: 'Pair', team: 'Team' };

// Sentence split for plain idea text (no abbreviations are allowed in it).
export function sentences(text) {
  return String(text || '').trim().split(/(?<=[.!?])\s+(?=[A-Z0-9"'(])/).filter((s) => s.trim());
}

const TEXT_FIELDS = (c) => [c.title, c.pitch, c.whatItDoes, ...(c.stack || [])];

// Returns a list of problems; an empty list means the card is valid.
export function validateIdea(c, { requireSource = true } = {}) {
  const p = [];
  const L = IDEAS.limits;
  if (!c || typeof c !== 'object') return ['not an object'];
  const str = (v) => typeof v === 'string' && v.trim().length > 0;
  if (requireSource && (!str(c.id) || c.id !== slugify(c.id))) p.push('id must be a non-empty slug');
  if (!str(c.title)) p.push('title is missing');
  else {
    const w = wordCount(c.title);
    if (w < L.titleWords[0] || w > L.titleWords[1]) p.push(`title is ${w} words; it must be ${L.titleWords[0]} to ${L.titleWords[1]}`);
    if (c.title.length > L.titleChars) p.push(`title is ${c.title.length} characters; the limit is ${L.titleChars}`);
  }
  if (!str(c.pitch)) p.push('pitch is missing');
  else {
    if (/\n/.test(c.pitch)) p.push('pitch must be one line');
    if (c.pitch.length > L.pitchChars) p.push(`pitch is ${c.pitch.length} characters; the limit is ${L.pitchChars}`);
    const w = wordCount(c.pitch);
    if (w < L.pitchWords[0] || w > L.pitchWords[1]) p.push(`pitch is ${w} words; it must be ${L.pitchWords[0]} to ${L.pitchWords[1]}`);
  }
  if (!str(c.whatItDoes)) p.push('whatItDoes is missing');
  else {
    const n = sentences(c.whatItDoes).length;
    if (n < 3 || n > 4) p.push(`whatItDoes is ${n} sentences; it must be 3 to 4`);
    const w = wordCount(c.whatItDoes);
    if (w < L.whatWords[0] || w > L.whatWords[1]) p.push(`whatItDoes is ${w} words; it must be ${L.whatWords[0]} to ${L.whatWords[1]}`);
    if (!/\bdemo\b/i.test(c.whatItDoes)) p.push('whatItDoes must describe the demo moment (a sentence about the demo)');
  }
  if (!Array.isArray(c.niches) || c.niches.length < 1 || c.niches.length > 3) p.push('niches must list 1 to 3 niches');
  else {
    const bad = c.niches.filter((n) => !NICHES.includes(n));
    if (bad.length) p.push(`unknown niches: ${bad.join(', ')}`);
    if (new Set(c.niches).size !== c.niches.length) p.push('niches repeat');
  }
  if (!Array.isArray(c.stack) || c.stack.length < L.stackItems[0] || c.stack.length > L.stackItems[1]) p.push(`stack must list ${L.stackItems[0]} to ${L.stackItems[1]} items`);
  else if (c.stack.some((s) => !str(s) || s.length > L.stackItemChars)) p.push(`each stack item must be 1 to ${L.stackItemChars} characters`);
  if (!DIFFICULTIES.includes(c.difficulty)) p.push(`difficulty must be one of ${DIFFICULTIES.join(', ')}`);
  if (!TEAM_SIZES.includes(c.teamSize)) p.push(`teamSize must be one of ${TEAM_SIZES.join(', ')}`);
  if (TEXT_FIELDS(c).some((t) => /—/.test(String(t ?? '')))) p.push('contains an em dash');
  if (requireSource) {
    const s = c.source || {};
    if (!['seed', 'generated'].includes(s.kind)) p.push('source.kind must be seed or generated');
    if (!/^\d{4}-\d{2}-\d{2}$/.test(s.date || '')) p.push('source.date must be YYYY-MM-DD');
  }
  return p;
}

// ---------- near-duplicate check ----------

const STOP = new Set(`a an and are as at be by do for from get gets go in into is it its no of on or so that the their them they this to up us via with without who what when where which while your you our my me we
app apps tool tools platform platforms system systems assistant bot bots smart simple ai online web mobile based using new free one two three every each`.split(/\s+/));

// Lower case content words, lightly stemmed ("alerts" -> "alert").
export function keywords(text) {
  const out = new Set();
  for (let w of String(text || '').toLowerCase().replace(/[^a-z0-9\s-]/g, ' ').split(/[\s-]+/)) {
    if (!w || STOP.has(w) || w.length < 2) continue;
    if (w.length > 4 && w.endsWith('ies')) w = `${w.slice(0, -3)}y`;
    else if (w.length > 3 && w.endsWith('s') && !w.endsWith('ss')) w = w.slice(0, -1);
    if (!STOP.has(w)) out.add(w);
  }
  return out;
}

const inter = (a, b) => [...a].filter((x) => b.has(x));

// A card is a near-duplicate of an existing one when they share a niche and
// their titles share keywords (two or more, or half of the shorter title),
// or their pitches mostly use the same words.
export function duplicateOf(card, existing) {
  const t = keywords(card.title);
  const pk = keywords(card.pitch);
  for (const e of existing) {
    if (e.id && e.id === card.id) continue;
    const niches = (card.niches || []).filter((n) => (e.niches || []).includes(n));
    if (!niches.length) continue;
    const et = keywords(e.title);
    const shared = inter(t, et);
    const ratio = shared.length / Math.max(1, Math.min(t.size, et.size));
    const ep = keywords(e.pitch);
    const pShared = inter(pk, ep);
    const jaccard = pShared.length / Math.max(1, new Set([...pk, ...ep]).size);
    if (shared.length >= 2 || ratio >= 0.5 || jaccard >= IDEAS.pitchJaccard) {
      return {
        id: e.id,
        title: e.title,
        sharedNiches: niches,
        sharedTitleKeywords: shared,
        pitchOverlap: Math.round(jaccard * 100) / 100,
        reason: `near-duplicate of "${e.title}" (${e.id}): same niche ${niches.join(', ')}`
          + (shared.length ? `, shared title keywords: ${shared.join(', ')}` : '')
          + (jaccard >= IDEAS.pitchJaccard ? `, pitch word overlap ${Math.round(jaccard * 100)}%` : ''),
      };
    }
  }
  return null;
}

// ---------- niche balance ----------

export function nicheCounts(ideas) {
  const counts = Object.fromEntries(NICHES.map((n) => [n, 0]));
  for (const c of ideas) for (const n of c.niches) if (n in counts) counts[n] += 1;
  return counts;
}

// Assign `n` new cards to the thinnest niches, one at a time, always to the
// niche with the fewest cards so far (ties go to the taxonomy order).
export function thinnestTargets(ideas, n) {
  const counts = nicheCounts(ideas);
  const out = [];
  for (let i = 0; i < n; i++) {
    const niche = [...NICHES].sort((a, b) => counts[a] - counts[b] || NICHES.indexOf(a) - NICHES.indexOf(b))[0];
    out.push(niche);
    counts[niche] += 1;
  }
  return out;
}

export function uniqueIdeaId(title, taken) {
  const base = slugify(title).slice(0, 60).replace(/-+$/, '') || 'idea';
  let id = base;
  for (let i = 2; taken.has(id); i++) id = `${base}-${i}`;
  return id;
}

// All cards: seed first, then generated, each in file order.
export function allIdeas(seed, generated) {
  return [...(seed?.ideas || []), ...(generated?.ideas || [])];
}
