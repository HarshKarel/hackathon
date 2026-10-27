#!/usr/bin/env node
// One-time backfill: every event still carrying a placeholder description
// from the early build (built before an AI key was set) is queued for
// rewriting through the batch flow, without fetching any source.
//
//   npm run backfill -- --dry-run    count and list what would be queued
//   npm run backfill                 rewrite them all (one Batch API job)
//   npm run backfill -- --limit=50   only the first 50 (by slug)
//
// Needs LLM_API_KEY and LLM_MODEL. Do not run it at the same time as the
// listing pipeline: both write data/events.json.
//
// Listing text (used to check that no sentence is copied) comes from
// .cache/source-text.json, which a listing pipeline run fills in. Events with
// no saved listing text are rewritten from their facts alone; the model never
// sees text it could copy.
import fs from 'node:fs';
import { PATHS } from './config.mjs';
import { logAiRun } from './lib/aiflow.mjs';
import { aiStatus, createGemini, redact } from './lib/gemini.mjs';
import { applyRewriteOutcome, collectPendingRewrites, forgetPendingJobs, rememberPendingJob, rewriteMany } from './lib/rewrite.mjs';
import { loadStore, saveStore } from './lib/store.mjs';

const log = (...m) => console.log(`[backfill] ${m.join(' ')}`);

export function backfillCandidates(events) {
  return [...events.values()].filter((e) => e.descriptionStatus === 'placeholder').sort((a, b) => a.slug.localeCompare(b.slug));
}

export async function runBackfill(argv = process.argv.slice(2), { ai: injected, env = process.env, now = new Date() } = {}) {
  const dryRun = argv.includes('--dry-run');
  const limitArg = argv.find((a) => a.startsWith('--limit='));
  const store = loadStore();
  let sourceText = {};
  try { sourceText = JSON.parse(fs.readFileSync(PATHS.sourceText, 'utf8')); } catch { /* none saved yet */ }

  let queue = backfillCandidates(store.events);
  if (limitArg) queue = queue.slice(0, Number(limitArg.slice(8)));
  const withText = queue.filter((e) => sourceText[e.slug]).length;
  log(`${queue.length} events still have a placeholder description (${withText} with saved listing text)`);
  if (dryRun) {
    for (const e of queue.slice(0, 20)) log(`  would queue ${e.slug}`);
    if (queue.length > 20) log(`  ...and ${queue.length - 20} more`);
    return { queued: queue.length, dryRun: true };
  }

  const ai = injected || createGemini(env);
  if (!ai) throw new Error(`cannot backfill: ${aiStatus(env).reason}`);
  log(`model ${ai.model}`);

  const earlier = await collectPendingRewrites(ai, { log });
  const finishedJobs = [...earlier.collectedJobIds];
  const entries = queue.filter((e) => !earlier.busy.has(e.slug)).map((e) => ({ e, sourceText: sourceText[e.slug] || '' }));
  const flow = await rewriteMany(entries, ai, {
    log,
    now,
    prefilled: earlier.prefilled,
    onSubmitted: (jobId, items) => rememberPendingJob('rewrite', jobId, items, now),
    onCollected: (jobId) => finishedJobs.push(jobId),
  });

  const kinds = { ai: 0, review: 0, error: 0, pending: 0 };
  for (const { e } of entries) {
    const kind = applyRewriteOutcome(e, flow.outcomes.get(e.slug), now);
    kinds[kind] += 1;
    // Already published pages stay up; a page never published stays hidden
    // while it waits for review.
    e.published = e.descriptionStatus !== 'review' || Boolean(e.publishedAt);
  }
  saveStore(store, now);
  forgetPendingJobs(finishedJobs);
  const reviewQueue = [...store.events.values()].filter((e) => e.descriptionStatus === 'review' && e.reviewInfo).map((e) => e.reviewInfo);
  fs.writeFileSync(PATHS.reviewQueue, JSON.stringify(reviewQueue, null, 2) + '\n');

  const run = logAiRun({ kind: 'rewrite', runAt: now.toISOString(), model: ai.model, trigger: 'backfill', queued: queue.length, collectedEarlierJobs: earlier.collected, rounds: flow.rounds, outcomes: kinds });
  for (const r of run.rounds) {
    log(`round ${r.round}: ${r.mode}${r.jobId ? ` job ${r.jobId}` : ''}, ${r.items} items, ${r.accepted} accepted, ${r.rejected} rejected, ${r.failed} failed, $${r.estimatedCostUsd}`);
  }
  log(`done: ${kinds.ai} rewritten, ${kinds.review} flagged for review, ${kinds.error} left as placeholders after API errors, ${kinds.pending} waiting on a batch job; estimated cost $${run.totals.estimatedCostUsd}`);
  return { queued: queue.length, outcomes: kinds, run };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  runBackfill().catch((err) => {
    console.error(`[backfill] fatal: ${redact(err.stack || err.message)}`);
    process.exit(1);
  });
}
