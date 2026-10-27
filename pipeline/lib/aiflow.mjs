// The shared AI flow for both AI jobs (listing rewrites and idea generation):
//
//   1. collect every pending item for this run
//   2. at least AI.minBatchItems items: submit them as ONE Gemini Batch API
//      job, log its id and item count, and poll until it finishes;
//      fewer items: standard generateContent requests on the same model
//   3. hand each result back to the caller, who runs it through the
//      validators and counts what was accepted and rejected
//
// Every round is written to data/health/ai-runs.jsonl by logAiRun().
import fs from 'node:fs';
import { AI, PATHS } from '../config.mjs';
import { addUsage, costUsd, responseText, usageOf, ZERO_USAGE } from './gemini.mjs';

async function pool(items, size, fn) {
  let i = 0;
  await Promise.all(Array.from({ length: Math.min(size, items.length) }, async () => {
    while (i < items.length) {
      const idx = i++;
      await fn(items[idx], idx);
    }
  }));
}

// items: [{ key, request }]. Returns
//   { mode: 'batch' | 'standard' | 'none', jobId, state, timedOut, items,
//     results: Map(key -> { text } | { error }), usage }
export async function runRequests(ai, items, {
  label = 'ai', log = () => {}, minBatch = AI.minBatchItems, now = new Date(),
  pollMs, maxWaitMs, onSubmitted = () => {},
} = {}) {
  const results = new Map();
  let usage = { ...ZERO_USAGE };
  if (!items.length) return { mode: 'none', jobId: null, state: null, timedOut: false, items: 0, results, usage };

  if (items.length >= minBatch) {
    const display = `hackathon-so-${label}-${now.toISOString().slice(0, 16).replace(/[:T]/g, '-')}`;
    const jobId = await ai.batchCreate(items, display);
    log(`${label}: batch job ${jobId} submitted with ${items.length} items`);
    onSubmitted(jobId);
    let lastState = null;
    const { op, state, timedOut } = await ai.batchWait(jobId, {
      pollMs,
      maxWaitMs,
      onPoll: (s) => { if (s !== lastState) { log(`${label}: batch job ${jobId} is ${s}`); lastState = s; } },
    });
    if (timedOut) {
      log(`${label}: stopped waiting for batch job ${jobId} (still ${state}); the next run collects it`);
      return { mode: 'batch', jobId, state, timedOut: true, items: items.length, results, usage };
    }
    if (state !== 'SUCCEEDED') {
      const why = op?.error?.message ? `: ${op.error.message}` : '';
      for (const it of items) results.set(it.key, { error: `batch job ${state.toLowerCase()}${why}` });
      log(`${label}: batch job ${jobId} ended ${state}${why}`);
      return { mode: 'batch', jobId, state, timedOut: false, items: items.length, results, usage };
    }
    const out = ai.batchResults(op);
    out.forEach((r, i) => {
      // Results come back in input order with our key echoed in metadata.
      const key = r.key ?? items[i]?.key;
      if (r.error) results.set(key, { error: `item failed: ${r.error.message || r.error.code || 'unknown error'}` });
      else {
        usage = addUsage(usage, usageOf(r.response));
        results.set(key, responseText(r.response));
      }
    });
    for (const it of items) if (!results.has(it.key)) results.set(it.key, { error: 'no result for this item in the batch output' });
    return { mode: 'batch', jobId, state, timedOut: false, items: items.length, results, usage };
  }

  await pool(items, AI.standardConcurrency, async (it) => {
    try {
      const res = await ai.generate(it.request);
      usage = addUsage(usage, usageOf(res));
      results.set(it.key, responseText(res));
    } catch (err) {
      results.set(it.key, { error: err.message });
    }
  });
  log(`${label}: ${items.length} standard requests (fewer than ${minBatch} items, so no batch job)`);
  return { mode: 'standard', jobId: null, state: null, timedOut: false, items: items.length, results, usage };
}

// One line per round for the run log.
export function roundSummary(round, res, counts) {
  return {
    round,
    mode: res.mode,
    jobId: res.jobId,
    state: res.state,
    timedOut: res.timedOut,
    items: res.items,
    accepted: counts.accepted,
    rejected: counts.rejected,
    failed: counts.failed,
    tokens: res.usage,
    estimatedCostUsd: costUsd(res.usage),
  };
}

export function logAiRun(entry, file = PATHS.aiRuns) {
  const usage = entry.rounds.reduce((u, r) => addUsage(u, r.tokens || ZERO_USAGE), { ...ZERO_USAGE });
  const line = {
    ...entry,
    totals: {
      items: entry.rounds.reduce((n, r) => n + (r.round === 1 ? r.items : 0), 0),
      accepted: entry.rounds.reduce((n, r) => n + r.accepted, 0),
      rejected: entry.rounds.reduce((n, r) => n + r.rejected, 0),
      failed: entry.rounds.reduce((n, r) => n + r.failed, 0),
      tokens: usage,
      estimatedCostUsd: costUsd(usage),
      priceUsedPerMillion: AI.pricePerMillion,
    },
  };
  fs.mkdirSync(PATHS.healthDir, { recursive: true });
  fs.appendFileSync(file, JSON.stringify(line) + '\n');
  return line;
}

// ---------- batch jobs still running when a run stopped waiting ----------

export function loadPending(file = PATHS.aiPending) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return { jobs: [] }; }
}

export function savePending(data, file = PATHS.aiPending) {
  if (!data.jobs.length) {
    if (fs.existsSync(file)) fs.rmSync(file);
    return;
  }
  fs.writeFileSync(file, JSON.stringify(data, null, 1) + '\n');
}
