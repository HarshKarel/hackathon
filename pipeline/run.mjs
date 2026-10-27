#!/usr/bin/env node
// hackathon.so pipeline: fetch every source, normalise, dedupe, fold into the
// permanent store, rewrite descriptions, score, and write the health log.
//
//   npm run pipeline                 full live run
//   npm run pipeline -- --use-cache  reuse raw responses saved in .cache/http
//   npm run pipeline -- --only=mlh,devpost
//   npm run pipeline -- --no-ai      placeholders even if LLM_API_KEY is set
import fs from 'node:fs';
import { ENDED_LOOKBACK_DAYS, PATHS, PLATFORMS } from './config.mjs';
import devpost from './adapters/devpost.mjs';
import devfolio from './adapters/devfolio.mjs';
import mlh from './adapters/mlh.mjs';
import hackerearth from './adapters/hackerearth.mjs';
import ethglobal from './adapters/ethglobal.mjs';
import hackclub from './adapters/hackclub.mjs';
import seed from './adapters/seed.mjs';
import { dedupe } from './lib/dedupe.mjs';
import { createHealth } from './lib/health.mjs';
import { createHttp } from './lib/http.mjs';
import { createLlm, llmStatus, redact } from './lib/llm.mjs';
import { qualityScore } from './lib/quality.mjs';
import { normaliseListing, sourceKey } from './lib/record.mjs';
import { checkRewrite, factsFor, factsHash, placeholderFor, rewriteEvent } from './lib/rewrite.mjs';
import { computeStatus } from './lib/status.mjs';
import { integrate, loadStore, saveStore } from './lib/store.mjs';
import { deriveSeries } from './lib/series.mjs';

export const ADAPTERS = [seed, devpost, devfolio, mlh, hackerearth, ethglobal, hackclub];

function parseArgs(argv) {
  const args = { useCache: false, only: null, noAi: false };
  for (const a of argv) {
    if (a === '--use-cache') args.useCache = true;
    else if (a === '--no-ai') args.noAi = true;
    else if (a.startsWith('--only=')) args.only = a.slice(7).split(',').map((s) => s.trim());
  }
  return args;
}

const log = (...m) => console.log(`[pipeline] ${m.join(' ')}`);

async function pool(items, size, fn) {
  let i = 0;
  const workers = Array.from({ length: Math.min(size, items.length) }, async () => {
    while (i < items.length) {
      const idx = i++;
      await fn(items[idx], idx);
    }
  });
  await Promise.all(workers);
}

function readJson(file, fallback) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return fallback; }
}

// Run adapters side by side. A failing adapter is recorded in the health
// log and the others carry on. Returns every normalised listing.
export async function fetchAll(adapters, ctx, health) {
  const normalised = [];
  const { now } = ctx;
  await Promise.all(adapters.map(async (adapter) => {
    const t0 = Date.now();
    try {
      const res = await adapter.fetch(ctx);
      let ok = 0;
      const normErrors = [];
      for (const listing of res.listings) {
        try {
          normalised.push(normaliseListing(listing, now));
          ok += 1;
        } catch (err) {
          normErrors.push(err.message);
        }
      }
      health.source(adapter.platform, {
        ok: true,
        fetched: res.fetched,
        listings: res.listings.length,
        normalised: ok,
        errors: [...res.errors, ...normErrors].slice(0, 50),
        errorCount: res.errors.length + normErrors.length,
        durationMs: Date.now() - t0,
      });
      ctx.log(`${adapter.platform}: ${ok} records (${res.errors.length + normErrors.length} item errors) in ${Date.now() - t0} ms`);
    } catch (err) {
      // One broken adapter is logged and the run continues.
      health.source(adapter.platform, {
        ok: false,
        fetched: 0,
        listings: 0,
        normalised: 0,
        errors: [String(err.message || err)],
        errorCount: 1,
        durationMs: Date.now() - t0,
      });
      ctx.log(`ERROR ${adapter.platform}: ${err.message}`);
    }
  }));

  return normalised;
}

export async function run(argv = process.argv.slice(2)) {
  const args = parseArgs(argv);
  const now = new Date();
  const endedCutoff = new Date(now.getTime() - ENDED_LOOKBACK_DAYS * 86_400_000);
  const http = createHttp({ useCache: args.useCache });
  const health = createHealth(now, { cached: args.useCache });
  fs.mkdirSync(PATHS.cache, { recursive: true });

  // 1. Fetch. Adapters run side by side; each one's failure is isolated.
  const adapters = ADAPTERS.filter((a) => !args.only || args.only.includes(a.platform));
  const normalised = [];
  const store = loadStore();
  const knownSourceKeys = new Set([...store.events.values()].flatMap((e) => e.sources.map(sourceKey)));
  normalised.push(...await fetchAll(adapters, { http, now, endedCutoff, knownSourceKeys, log }, health));

  // Keep a deterministic order regardless of which adapter finished first.
  normalised.sort((a, b) => sourceKey(a.record.sources[0]).localeCompare(sourceKey(b.record.sources[0])));

  // 2. Dedupe within this run, then 3. fold into the permanent store.
  const { merged, merges } = dedupe(normalised);
  const integ = integrate(store, merged, { now, endedCutoff });
  log(`dedupe: ${normalised.length} records -> ${merged.length} events (${merges.filter((m) => m.pass === 1).length} pass-1 and ${merges.filter((m) => m.pass === 2).length} pass-2 merges)`);
  log(`store: ${integ.added.length} new, ${integ.updated.length} updated, ${integ.skippedOld} old ended skipped, ${integ.absorbed.length} absorbed`);
  const seriesFound = deriveSeries([...store.events.values()]);
  log(`series: ${seriesFound.length} detected from titles`);

  // 4. Rewrite engine.
  const sourceTextCache = readJson(PATHS.sourceText, {});
  const reviews = readJson(PATHS.reviews, {});
  const status = llmStatus();
  const llm = args.noAi ? null : createLlm();
  if (!llm) log(`AI rewrites off: ${args.noAi ? '--no-ai flag' : status.reason}. Using flagged placeholder descriptions.`);
  else log(`AI rewrites on with model ${llm.model}`);

  const reviewQueue = [];
  const jobs = [];
  const counts = { ai: 0, reviewed: 0, placeholder: 0, review: 0, unchanged: 0 };
  let pendingRewrites = 0;
  let aiErrors = 0;
  for (const e of store.events.values()) {
    const seen = integ.seen.get(e.slug);
    // A listing that arrives without its text (thin list data) keeps the text
    // read earlier, so the hash does not change for no reason.
    if (seen && seen.sourceText) sourceTextCache[e.slug] = seen.sourceText;
    const sourceText = sourceTextCache[e.slug] || '';
    const hash = seen ? factsHash(e, sourceText) : e.factsHash || factsHash(e, sourceText);
    const changed = hash !== e.factsHash;
    e.factsHash = hash;
    const review = reviews[e.slug];
    if (review && review.factsHash === hash && review.decision === 'approve' && review.description) {
      // Human-approved text still has to pass the same checks.
      const problems = checkRewrite({ description: review.description, summary: review.summary || '' }, sourceText, factsFor(e))
        .filter((p) => !/words; it must be|summary must be/.test(p));
      if (!problems.length) {
        e.description = review.description;
        e.summary = review.summary || e.summary;
        e.descriptionStatus = 'reviewed';
        delete e.reviewInfo;
        continue;
      }
      log(`review for ${e.slug} not applied: ${problems.join('; ')}`);
    }
    if (llm) {
      if (e.descriptionStatus === 'review' && !changed) { reviewQueue.push(e.reviewInfo); continue; }
      const needs = changed || !e.description || e.descriptionStatus === 'placeholder' || e.descriptionStatus === 'review';
      if (needs) jobs.push({ e, sourceText });
      else counts.unchanged += 1;
    } else if (e.descriptionStatus === 'review') {
      // Without AI a flagged event stays flagged (and unpublished if it never
      // went live); only its placeholder text follows the facts.
      if (changed) Object.assign(e, placeholderFor(e));
      reviewQueue.push(e.reviewInfo);
    } else if (changed || !e.description || e.descriptionStatus === 'placeholder') {
      // Count what an AI run would have to rewrite (new or changed facts).
      if (changed || !e.description) pendingRewrites += 1;
      // Facts changed and there is no AI: an old AI text may now be stale,
      // so fall back to a flagged placeholder built only from the facts.
      Object.assign(e, placeholderFor(e), { descriptionStatus: 'placeholder' });
      delete e.reviewInfo;
    } else {
      counts.unchanged += 1;
    }
  }

  await pool(jobs, 4, async ({ e, sourceText }) => {
    const r = await rewriteEvent(e, sourceText, llm);
    if (r.descriptionStatus === 'ai') {
      Object.assign(e, { description: r.description, summary: r.summary, descriptionStatus: 'ai', rewrittenAt: now.toISOString() });
      delete e.reviewInfo;
    } else if (r.descriptionStatus === 'error') {
      // API trouble, not a bad draft: publish a flagged placeholder and
      // retry next run (placeholders are always queued for rewriting).
      Object.assign(e, placeholderFor(e), { descriptionStatus: 'placeholder', lastAiError: redact(r.problems[0] || 'AI call failed') });
      aiErrors += 1;
    } else {
      // Flagged for review. A never-published event stays unpublished; a
      // page that is already live keeps a flagged placeholder meanwhile.
      Object.assign(e, placeholderFor(e), { descriptionStatus: 'review' });
      e.reviewInfo = {
        slug: e.slug, title: e.title, factsHash: e.factsHash, attempts: r.attempts,
        problems: r.problems.map((p) => redact(p)), rejectedDraft: r.rejected || null, flaggedAt: now.toISOString(),
      };
      reviewQueue.push(e.reviewInfo);
    }
  });

  // 5. Status, quality, publish state.
  for (const e of store.events.values()) {
    e.status = computeStatus(e, now);
    const q = qualityScore(e);
    e.qualityScore = q.score;
    e.qualityMissing = q.missing;
    e.indexable = q.indexable;
    e.published = e.descriptionStatus !== 'review' || Boolean(e.publishedAt);
    if (e.published && !e.publishedAt) e.publishedAt = now.toISOString();
    counts[e.descriptionStatus] += 1;
  }

  saveStore(store, now);
  fs.writeFileSync(PATHS.sourceText, JSON.stringify(sourceTextCache));
  fs.writeFileSync(PATHS.reviewQueue, JSON.stringify(reviewQueue.filter(Boolean), null, 2) + '\n');
  fs.mkdirSync(PATHS.healthDir, { recursive: true });
  fs.writeFileSync(`${PATHS.healthDir}/last-merges.json`, JSON.stringify(merges, null, 2) + '\n');

  const events = [...store.events.values()];
  const byStatus = (s) => events.filter((e) => e.status === s).length;
  const run = health.finish({
    totals: {
      recordsNormalised: normalised.length,
      eventsAfterDedupe: merged.length,
      pass1Merges: merges.filter((m) => m.pass === 1).length,
      pass2Merges: merges.filter((m) => m.pass === 2).length,
      storeEvents: events.length,
      added: integ.added.length,
      updated: integ.updated.length,
      skippedOldEnded: integ.skippedOld,
      redirects: Object.keys(store.redirects).length,
      seriesDetected: seriesFound.length,
      matchedByPass1: integ.updated.filter((u) => u.matchedBy === 1).length,
      matchedByPass2: integ.updated.filter((u) => u.matchedBy === 2).length,
      absorbed: integ.absorbed,
      upcoming: byStatus('upcoming'),
      live: byStatus('live'),
      ended: byStatus('ended'),
      indexable: events.filter((e) => e.indexable && e.published).length,
      unpublished: events.filter((e) => !e.published).length,
    },
    descriptions: counts,
    ai: {
      configured: Boolean(llm),
      reason: llm ? null : args.noAi ? '--no-ai flag' : status.reason,
      model: llm?.model || null,
      calls: llm?.stats.calls || 0,
      failures: llm?.stats.failures || 0,
      inputTokens: llm?.stats.inputTokens || 0,
      outputTokens: llm?.stats.outputTokens || 0,
      rewritesAttempted: jobs.length,
      // Without a key: events whose facts are new or changed this run, i.e.
      // the minimum number of AI calls a keyed run would have made.
      newOrChangedWithoutAi: llm ? 0 : pendingRewrites,
      flaggedForReview: reviewQueue.filter(Boolean).length,
      apiErrors: aiErrors,
    },
    http: { ...http.stats, usedCache: args.useCache },
  });
  log(`done: ${events.length} events in store, ${run.ai.calls} AI calls, health log at data/health/latest.json`);
  for (const [p, s] of Object.entries(run.sources)) {
    log(`  ${(PLATFORMS[p]?.name || p).padEnd(22)} ${s.ok ? 'ok ' : 'ERR'} fetched=${s.fetched} normalised=${s.normalised} errors=${s.errorCount}`);
  }
  return run;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  run().catch((err) => {
    console.error(`[pipeline] fatal: ${redact(err.stack || err.message)}`);
    process.exit(1);
  });
}
