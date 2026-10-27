// Per-run health log. Every run appends one line to data/health/runs.jsonl
// and rewrites data/health/latest.json, which also carries each source's last
// successful fetch time forward. The public Sources page reads latest.json.
import fs from 'node:fs';
import { PATHS, PLATFORMS } from '../config.mjs';

export function createHealth(now, { cached = false } = {}) {
  let previous = {};
  try {
    previous = JSON.parse(fs.readFileSync(PATHS.healthLatest, 'utf8'));
  } catch {
    /* first run */
  }
  const run = {
    runId: now.toISOString().replace(/[:.]/g, '-'),
    startedAt: now.toISOString(),
    finishedAt: null,
    sources: {},
  };
  return {
    run,
    source(platform, data) {
      const prev = previous.sources?.[platform] || {};
      run.sources[platform] = {
        name: PLATFORMS[platform]?.name || platform,
        ...data,
        // A --use-cache run did not really fetch anything, so it never
        // counts as a successful fetch on the public Sources page.
        lastSuccessAt: data.ok && !cached ? run.startedAt : prev.lastSuccessAt || null,
        lastSuccessCount: data.ok && !cached ? data.normalised : prev.lastSuccessCount ?? null,
        fromCache: cached,
      };
    },
    finish(extra, finishedAt = new Date()) {
      run.finishedAt = finishedAt.toISOString();
      Object.assign(run, extra);
      // Sources not run this time (e.g. --only) keep their previous entry.
      for (const [p, prev] of Object.entries(previous.sources || {})) {
        if (!run.sources[p]) run.sources[p] = { ...prev, skippedThisRun: true };
      }
      fs.mkdirSync(PATHS.healthDir, { recursive: true });
      fs.appendFileSync(PATHS.healthRuns, JSON.stringify(run) + '\n');
      fs.writeFileSync(PATHS.healthLatest, JSON.stringify(run, null, 2) + '\n');
      return run;
    },
  };
}
