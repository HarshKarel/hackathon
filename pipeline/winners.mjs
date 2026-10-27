#!/usr/bin/env node
// Weekly winners pipeline, independent of the listing pipeline.
//
// For every event that ended in the last WINNERS_WINDOW_DAYS days and has no
// winners yet, check its Devpost and Devfolio listings for published winners.
// Results go to data/winners.json (never data/events.json, so the two
// pipelines never write the same file):
//   winnersStatus "published"      winners copied exactly as the platform states them
//   winnersStatus "not published"  checked, nothing published yet (re-checked weekly)
//
//   npm run winners
//   npm run winners -- --use-cache   reuse raw responses saved in .cache/http
//   npm run winners -- --limit=20    check at most 20 events (development)
import fs from 'node:fs';
import { PATHS, PLATFORMS, WINNERS_WINDOW_DAYS } from './config.mjs';
import { createHttp } from './lib/http.mjs';
import { loadStore } from './lib/store.mjs';
import { devfolioWinners, devpostWinners, winnersCandidates } from './lib/winners.mjs';

const log = (...m) => console.log(`[winners] ${m.join(' ')}`);

export function loadWinners(file = PATHS.winners) {
  try {
    const d = JSON.parse(fs.readFileSync(file, 'utf8'));
    return { ...d, events: d.events || {} };
  } catch {
    return { events: {} };
  }
}

export function saveWinners(data, now, file = PATHS.winners) {
  const events = Object.fromEntries(Object.entries(data.events).sort(([a], [b]) => a.localeCompare(b)));
  fs.writeFileSync(file, JSON.stringify({
    schema: 'hackathon.so winners v1 (see docs/RECORD_FORMAT.md)',
    updatedAt: now.toISOString(),
    count: Object.keys(events).length,
    events,
  }, null, 1) + '\n');
}

// Check one event. Returns the new winners entry, or null when no platform
// could be checked at all (the previous entry is then kept).
export async function checkEvent(e, http, now, prev = {}) {
  const tried = [];
  const failures = [];
  for (const src of e.sources.filter((s) => s.platform === 'devpost' || s.platform === 'devfolio')) {
    try {
      const r = src.platform === 'devpost' ? await devpostWinners(http, src.url) : await devfolioWinners(http, src.sourceId);
      tried.push(src.platform);
      if (r.winners.length) {
        return {
          entry: {
            winnersStatus: 'published',
            winners: r.winners,
            source: src.platform,
            sourceUrl: src.platform === 'devpost' ? r.checkedUrl : src.url,
            endDate: e.endDate,
            firstFoundAt: now.toISOString(),
            checkedAt: now.toISOString(),
          },
          failures,
        };
      }
    } catch (err) {
      failures.push(`${src.platform}: ${err.message}`);
    }
  }
  // "Not published" is only written when every listed platform was checked
  // successfully. Any failure keeps the previous entry and retries next week.
  if (!tried.length || failures.length) return { entry: null, failures };
  return {
    entry: {
      winnersStatus: 'not published',
      winners: [],
      checked: tried,
      endDate: e.endDate,
      firstCheckedAt: prev.firstCheckedAt || now.toISOString(),
      checkedAt: now.toISOString(),
    },
    failures,
  };
}

async function pool(items, size, fn) {
  let i = 0;
  await Promise.all(Array.from({ length: Math.min(size, items.length) }, async () => {
    while (i < items.length) await fn(items[i++]);
  }));
}

export async function runWinners(argv = process.argv.slice(2)) {
  const useCache = argv.includes('--use-cache');
  const limitArg = argv.find((a) => a.startsWith('--limit='));
  const now = new Date();
  const http = createHttp({ useCache });
  const store = loadStore();
  const data = loadWinners();

  // An event page absorbed into another (redirect) hands its winners on.
  for (const [from, to] of Object.entries(store.redirects)) {
    if (data.events[from] && !data.events[to]) data.events[to] = data.events[from];
    delete data.events[from];
  }

  let candidates = winnersCandidates([...store.events.values()], data.events, { now, windowDays: WINNERS_WINDOW_DAYS });
  if (limitArg) candidates = candidates.slice(0, Number(limitArg.slice(8)));
  log(`${candidates.length} ended events in the last ${WINNERS_WINDOW_DAYS} days with no winners yet`);

  const result = { checked: 0, published: [], notPublished: 0, couldNotCheck: [], errors: [] };
  await pool(candidates, 4, async (e) => {
    const { entry, failures } = await checkEvent(e, http, now, data.events[e.slug]);
    result.errors.push(...failures.map((f) => `${e.slug}: ${f}`));
    if (!entry) {
      result.couldNotCheck.push(e.slug);
      return;
    }
    result.checked += 1;
    data.events[e.slug] = entry;
    if (entry.winnersStatus === 'published') result.published.push({ slug: e.slug, source: entry.source, winners: entry.winners.length });
    else result.notPublished += 1;
  });

  saveWinners(data, now);

  const all = Object.values(data.events);
  const run = {
    runId: now.toISOString().replace(/[:.]/g, '-'),
    startedAt: now.toISOString(),
    finishedAt: new Date().toISOString(),
    windowDays: WINNERS_WINDOW_DAYS,
    candidates: candidates.length,
    checked: result.checked,
    newlyPublished: result.published.length,
    stillNotPublished: result.notPublished,
    couldNotCheck: result.couldNotCheck.length,
    errors: result.errors.slice(0, 50),
    errorCount: result.errors.length,
    totals: {
      published: all.filter((x) => x.winnersStatus === 'published').length,
      notPublished: all.filter((x) => x.winnersStatus === 'not published').length,
    },
    published: result.published,
    http: { ...http.stats, usedCache: useCache },
  };
  fs.mkdirSync(PATHS.healthDir, { recursive: true });
  fs.appendFileSync(PATHS.winnersRuns, JSON.stringify(run) + '\n');
  fs.writeFileSync(PATHS.winnersLatest, JSON.stringify(run, null, 2) + '\n');
  log(`checked ${run.checked}: ${run.newlyPublished} with winners, ${run.stillNotPublished} not published, ${run.couldNotCheck} could not be checked (${run.errorCount} errors)`);
  log(`totals: ${run.totals.published} events with winners, ${run.totals.notPublished} not published; sources ${Object.keys(PLATFORMS).filter((p) => p === 'devpost' || p === 'devfolio').join(', ')}`);
  return run;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  runWinners().catch((err) => {
    console.error(`[winners] fatal: ${err.stack || err.message}`);
    process.exit(1);
  });
}
