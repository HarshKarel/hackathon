#!/usr/bin/env node
// Weekly idea generator. Adds up to IDEAS.perWeek (10) new idea cards to the
// niches that currently have the fewest cards, through the shared AI flow:
// one Gemini Batch API job for the first round, then standard requests for
// the (fewer than 10) cards that have to be regenerated.
//
// Every generated card is checked in code before it is accepted:
//   - format and length limits, no em dashes (validateIdea)
//   - it covers the niche it was asked for
//   - not a near-duplicate of any existing card or one accepted earlier in
//     the run: shared title keywords (or mostly the same pitch) plus a
//     shared niche (duplicateOf)
// A rejected card is regenerated at most IDEAS.maxRegenerations (2) times
// with the reasons. Every rejection is logged (data/ideas-rejected.jsonl and
// data/health/ideas-latest.json); nothing is published silently.
//
//   npm run ideas
//   npm run ideas -- --count=4      fewer cards (development)
//   npm run ideas -- --dry-run      show the target niches and stop
import fs from 'node:fs';
import { AI, IDEAS, NICHES, PATHS } from './config.mjs';
import { logAiRun, roundSummary, runRequests } from './lib/aiflow.mjs';
import { aiStatus, createGemini, redact } from './lib/gemini.mjs';
import { allIdeas, DIFFICULTIES, duplicateOf, nicheCounts, TEAM_SIZES, thinnestTargets, uniqueIdeaId, validateIdea } from './lib/ideas.mjs';

const log = (...m) => console.log(`[ideas] ${m.join(' ')}`);
const readJson = (f, fb) => { try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch { return fb; } };

export const IDEA_SYSTEM_PROMPT = `You write project idea cards for hackathon.so, a worldwide hackathon directory. Each card is one project a team of one to four people can genuinely build and demo in a 24 to 48 hour hackathon with free or trial tools.
Rules:
1. Be concrete. Name the specific people it is for, the one core thing it does, and the moment in the demo that shows it working. Never write vague concepts such as "an AI platform for X" or "a marketplace for Y".
2. title: 2 to 8 words, at most 50 characters.
3. pitch: one sentence, 8 to 25 words, at most 130 characters.
4. whatItDoes: 3 or 4 sentences, 50 to 110 words. The first sentence says who it is for and their problem. The middle sentences say what it does and how. The last sentence starts with "In the demo," and describes what the audience sees.
5. niches: the required niche first, then at most two more from this list only: ${NICHES.join(', ')}.
6. stack: 2 to 5 short items (tools, APIs or hardware), each at most 40 characters.
7. difficulty and teamSize: use exactly the values you are given.
8. Never use em dashes. Do not use abbreviations with full stops (such as "e.g." or "i.e."). Plain, neutral English, no hype, no exclamation marks, no "you".
9. The idea must be clearly different from every existing idea listed: a different user, problem and core feature, not a variation of one of them.
Return only the JSON object.`;

const SCHEMA = {
  type: 'object',
  properties: {
    title: { type: 'string' },
    pitch: { type: 'string' },
    whatItDoes: { type: 'string' },
    niches: { type: 'array', items: { type: 'string', enum: NICHES }, minItems: 1, maxItems: 3 },
    stack: { type: 'array', items: { type: 'string' }, minItems: 2, maxItems: 5 },
    difficulty: { type: 'string', enum: DIFFICULTIES },
    teamSize: { type: 'string', enum: TEAM_SIZES },
  },
  required: ['title', 'pitch', 'whatItDoes', 'niches', 'stack', 'difficulty', 'teamSize'],
  propertyOrdering: ['title', 'pitch', 'whatItDoes', 'niches', 'stack', 'difficulty', 'teamSize'],
};

export function ideaPrompt(slot, existing, previous) {
  const same = existing.filter((c) => c.niches.includes(slot.niche));
  const others = existing.filter((c) => !c.niches.includes(slot.niche));
  let u = `Write one new idea card.
Required niche (list it first): ${slot.niche}
difficulty: ${slot.difficulty}
teamSize: ${slot.teamSize}

Existing ideas in ${slot.niche} (do not repeat or vary these):
${same.map((c) => `- ${c.title}: ${c.pitch}`).join('\n') || '- (none yet)'}

Other existing ideas (also avoid these):
${others.map((c) => `- ${c.title}`).join('\n') || '- (none)'}`;
  if (previous) {
    u += `\n\nYour previous card was rejected:\n${JSON.stringify(previous.card)}\nReasons:\n- ${previous.problems.join('\n- ')}\nWrite a different card that fixes every reason.`;
  }
  return u;
}

export function ideaRequest(slot, existing, previous) {
  return {
    systemInstruction: { parts: [{ text: IDEA_SYSTEM_PROMPT }] },
    contents: [{ role: 'user', parts: [{ text: ideaPrompt(slot, existing, previous) }] }],
    generationConfig: {
      responseMimeType: 'application/json',
      responseJsonSchema: SCHEMA,
      thinkingConfig: { thinkingLevel: AI.thinkingLevel },
      maxOutputTokens: AI.maxOutputTokens,
    },
    store: false,
  };
}

// Difficulty and team size for each slot: whichever the niche has fewest of,
// so new cards keep the mix varied.
export function planSlots(existing, count) {
  const targets = thinnestTargets(existing, count);
  const taken = existing.map((c) => ({ niches: c.niches, difficulty: c.difficulty, teamSize: c.teamSize }));
  return targets.map((niche, i) => {
    const inNiche = taken.filter((c) => c.niches.includes(niche));
    // Fewest in this niche first; ties rotate with the slot number so the
    // batch as a whole spreads across every value.
    const n = (field, v) => inNiche.filter((c) => c[field] === v).length;
    const turn = (values, v) => (values.indexOf(v) - i + values.length * 10) % values.length;
    const least = (values, field) => [...values].sort((a, b) => n(field, a) - n(field, b) || turn(values, a) - turn(values, b))[0];
    const slot = { slot: i + 1, niche, difficulty: least(DIFFICULTIES, 'difficulty'), teamSize: least(TEAM_SIZES, 'teamSize') };
    taken.push({ niches: [niche], difficulty: slot.difficulty, teamSize: slot.teamSize });
    return slot;
  });
}

function parseCard(text) {
  const m = String(text).match(/\{[\s\S]*\}/);
  if (!m) throw new Error('no JSON object in the output');
  const o = JSON.parse(m[0]);
  const s = (v) => (typeof v === 'string' ? v.trim() : v);
  return {
    title: s(o.title), pitch: s(o.pitch), whatItDoes: s(o.whatItDoes),
    niches: Array.isArray(o.niches) ? o.niches.map(s) : o.niches,
    stack: Array.isArray(o.stack) ? o.stack.map(s) : o.stack,
    difficulty: s(o.difficulty), teamSize: s(o.teamSize),
  };
}

// Problems with a generated card, in the order a person would fix them.
export function checkGenerated(card, slot, against) {
  const problems = validateIdea(card, { requireSource: false });
  if (Array.isArray(card.niches) && card.niches[0] !== slot.niche) problems.push(`the first niche must be ${slot.niche}`);
  if (card.difficulty !== slot.difficulty) problems.push(`difficulty must be ${slot.difficulty}`);
  if (card.teamSize !== slot.teamSize) problems.push(`teamSize must be ${slot.teamSize}`);
  const dup = card.title && card.pitch && Array.isArray(card.niches) ? duplicateOf(card, against) : null;
  return { problems: dup ? [...problems, dup.reason] : problems, duplicate: dup };
}

export async function runIdeas(argv = process.argv.slice(2), { ai: injected, env = process.env, now = new Date(), paths = PATHS } = {}) {
  const countArg = argv.find((a) => a.startsWith('--count='));
  const count = countArg ? Number(countArg.slice(8)) : IDEAS.perWeek;
  const seed = readJson(paths.ideasSeed, { ideas: [] });
  const generated = readJson(paths.ideasGenerated, { ideas: [] });
  const existing = allIdeas(seed, generated);
  const slots = planSlots(existing, count);
  log(`${existing.length} cards today; thinnest niches: ${Object.entries(nicheCounts(existing)).sort((a, b) => a[1] - b[1]).slice(0, 5).map(([n, c]) => `${n} ${c}`).join(', ')}`);
  log(`targets: ${slots.map((s) => `${s.niche} (${s.difficulty}, ${s.teamSize})`).join('; ')}`);
  if (argv.includes('--dry-run')) return { slots, dryRun: true };

  const ai = injected || createGemini(env);
  if (!ai) throw new Error(`cannot generate ideas: ${aiStatus(env).reason}`);
  const today = now.toISOString().slice(0, 10);
  const runId = now.toISOString().replace(/[:.]/g, '-');
  const accepted = [];
  const rejected = [];
  const rounds = [];
  const taken = new Set(existing.map((c) => c.id));
  const state = slots.map((s) => ({ ...s, done: false, previous: null, attempts: 0 }));

  for (let attempt = 1; attempt <= IDEAS.maxRegenerations + 1; attempt++) {
    const todo = state.filter((s) => !s.done);
    if (!todo.length) break;
    const pool = [...existing, ...accepted];
    const items = todo.map((s) => ({ key: `slot-${s.slot}-attempt-${attempt}`, request: ideaRequest(s, pool, s.previous) }));
    const res = await runRequests(ai, items, { label: `ideas round ${attempt}`, log, now });
    const counts = { accepted: 0, rejected: 0, failed: 0 };
    for (const s of todo) {
      s.attempts += 1;
      if (res.timedOut) {
        s.done = true;
        rejected.push({ runId, slot: s.slot, niche: s.niche, attempt, card: null, problems: [`batch job ${res.jobId} did not finish in time; nothing from it is published`] });
        counts.failed += 1;
        continue;
      }
      const r = res.results.get(`slot-${s.slot}-attempt-${attempt}`);
      let card = null;
      let problems;
      if (!r || r.error) problems = [r?.error || 'no result'];
      else {
        try { card = parseCard(r.text); } catch (err) { problems = [`unusable output: ${err.message}`]; }
      }
      let duplicate = null;
      if (card) ({ problems, duplicate } = checkGenerated(card, s, [...existing, ...accepted]));
      if (card && !problems.length) {
        const id = uniqueIdeaId(card.title, taken);
        taken.add(id);
        accepted.push({ id, ...card, source: { kind: 'generated', date: today, model: ai.model, batchJobId: res.jobId || null, run: runId } });
        s.done = true;
        counts.accepted += 1;
        continue;
      }
      const final = attempt > IDEAS.maxRegenerations;
      rejected.push({ runId, slot: s.slot, niche: s.niche, attempt, card, problems, duplicate, final });
      if (card) counts.rejected += 1; else counts.failed += 1;
      s.previous = card ? { card, problems } : s.previous;
      if (final) s.done = true;
    }
    rounds.push(roundSummary(attempt, res, counts));
    if (res.timedOut) break;
  }

  // Publish accepted cards; log every rejection.
  const out = { schema: 'hackathon.so idea cards v1 (see docs/RECORD_FORMAT.md). Written by pipeline/ideas.mjs.', updatedAt: now.toISOString(), ideas: [...(generated.ideas || []), ...accepted] };
  fs.writeFileSync(paths.ideasGenerated, JSON.stringify(out, null, 1) + '\n');
  if (rejected.length) fs.appendFileSync(paths.ideasRejected, rejected.map((r) => JSON.stringify(r)).join('\n') + '\n');
  const aiRun = logAiRun({ kind: 'ideas', runAt: now.toISOString(), model: ai.model, runId, rounds }, paths.aiRuns);
  const summary = {
    runId,
    runAt: now.toISOString(),
    model: ai.model,
    requested: count,
    targets: slots,
    accepted: accepted.map((c) => ({ id: c.id, title: c.title, niches: c.niches })),
    notFilled: count - accepted.length,
    rejected,
    rounds: aiRun.rounds,
    totals: aiRun.totals,
  };
  fs.mkdirSync(paths.healthDir, { recursive: true });
  fs.appendFileSync(paths.ideasRuns, JSON.stringify(summary) + '\n');
  fs.writeFileSync(paths.ideasLatest, JSON.stringify(summary, null, 2) + '\n');
  for (const r of rounds) log(`round ${r.round}: ${r.mode}${r.jobId ? ` job ${r.jobId}` : ''}, ${r.items} items, ${r.accepted} accepted, ${r.rejected} rejected, ${r.failed} failed`);
  for (const r of rejected) log(`rejected (slot ${r.slot}, ${r.niche}, attempt ${r.attempt}${r.final ? ', final' : ''}): ${r.card?.title || '(no card)'}: ${r.problems.join('; ')}`);
  log(`done: ${accepted.length} of ${count} cards added, ${rejected.length} rejections logged; estimated cost $${aiRun.totals.estimatedCostUsd}`);
  return summary;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  runIdeas().catch((err) => {
    console.error(`[ideas] fatal: ${redact(err.stack || err.message)}`);
    process.exit(1);
  });
}
