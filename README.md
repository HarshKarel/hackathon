# hackathon.so

A worldwide hackathon directory. Every hackathon gets one permanent page that
lives forever: status moves from upcoming to live to ended, and the page stays
published after the event ends.

This repo is Phase 1 of 3: the data pipeline, the rewrite engine and the
static site. (Winners, guides and the idea feed come later.)

## Quick start

Requires Node.js 20 or newer.

```bash
npm install
npm run pipeline     # fetch every source, update data/events.json (about 11 min first run, 5 min after)
npm run build        # build the static site into _site/
npm run check        # verify the built site against the project rules
npm run serve        # local preview at http://localhost:8080
npm test             # unit tests
```

`data/events.json` and the health log are committed, so `npm run build` works
straight after cloning without running the pipeline.

### Pipeline options

```bash
npm run pipeline                       # full live run
npm run pipeline -- --use-cache        # reuse raw responses saved in .cache/http (development)
npm run pipeline -- --only=mlh,devpost # run some adapters; the rest of the store is untouched
npm run pipeline -- --no-ai            # placeholders even if an AI key is set
```

The pipeline is a plain script so it can be scheduled later (cron, CI) with
`npm run pipeline && npm run build`.

## Environment variables

| Name | Used for |
| --- | --- |
| `LLM_API_KEY` | API key for the rewrite engine (Anthropic Messages API). Never logged or stored. |
| `LLM_MODEL` | Model id for the rewrite engine, for example a current Claude model id. Not hardcoded anywhere. |

Copy `.env.example` and export the values, for example:

```bash
export LLM_API_KEY=...   # leave unset to use flagged placeholder descriptions
export LLM_MODEL=...
npm run pipeline
```

If either variable is missing the pipeline still builds everything and writes
clearly flagged placeholder descriptions made only from the facts. Event pages
show a notice and placeholders do not count towards the quality score.

## How it works

```
pipeline/
  adapters/     one module per source: devpost, devfolio, mlh, hackerearth, ethglobal, hackclub, seed
  lib/http.mjs  polite fetch: bot user agent, robots.txt check, one request per second per host, retries
  lib/record.mjs   normalise a listing into the record (docs/RECORD_FORMAT.md)
  lib/dedupe.mjs   pass 1 exact source id, pass 2 normalised title + organiser + start date
  lib/store.mjs    permanent store with stable slugs and redirects
  lib/series.mjs   series from source data, or from titles that differ only by year/edition
  lib/rewrite.mjs  facts hash, AI rewrite, checks, retry, review flag, placeholders
  lib/health.mjs   per-run health log (data/health/runs.jsonl, data/health/latest.json)
  run.mjs          the pipeline entry point
src/            Eleventy site (templates, data layer, CSS, small ES modules)
data/
  events.json        permanent event store (pipeline output)
  seed-events.json   hand-maintained events with no feed (docs/SEED_FORMAT.md)
  reviews.json       optional human approvals for flagged descriptions
  review-queue.json  events whose AI description failed checks twice
  health/            run log and latest per-source status (feeds the Sources page)
```

### Sources

| Source | Read from |
| --- | --- |
| Devpost | `devpost.com/api/hackathons` (open, upcoming, recently ended) plus each event page for the exact deadline, eligibility and address |
| Devfolio | `api.devfolio.co/api/hackathons` (open, upcoming, past) plus each open event's prize list |
| MLH | Embedded JSON on `www.mlh.com/seasons/<year>/events` for the current and next season |
| HackerEarth | `www.hackerearth.com/chrome-extension/events/`, hackathons only |
| ETHGlobal | `ethglobal.com/events` page data, type `hackathon` only |
| Hack Club | `hackathons.hackclub.com/api/events/all/` |
| Seed | `data/seed-events.json` (NASA Space Apps, Smart India Hackathon) |

Dedupe pass 2 compares titles without case, punctuation, years or edition
numbers ("SpartaHack 12" on Devpost is "SpartaHack" on MLH), start dates
within one day, organisers when both state one, and countries when both state
one.

Each adapter runs in isolation: if one fails, the error goes into the health
log and the run continues with the others. Ended events are back-filled only
if they ended within the last 60 days; once stored, an event is never removed.

### Rewrite engine

1. Each event's facts plus the source's own description are hashed.
2. Only new or changed events go to the AI (concurrency 4).
3. Output must be 80 to 140 words with a one-line summary, contain no em dash,
   share no full sentence with the source text, and mention no number, month
   or weekday that is not in the facts.
4. A failed check is retried once with the reasons. A second failure flags the
   event in `data/review-queue.json`; a never-published event stays
   unpublished until approved in `data/reviews.json`:

```json
{ "<slug>": { "decision": "approve", "factsHash": "<hash from the queue>", "summary": "...", "description": "..." } }
```

### Site

Built with Eleventy: it outputs plain HTML with no client framework, and data
pagination gives each event its own permanent URL. Pages:

- `/` open events sorted by deadline, search and filters (status, format,
  niche, country, deadline window, source), niche counts, Closing Soon rail
- `/hackathons/<slug>/` event page with status banner, key facts, original
  description, prize and eligibility as stated, deadline in the visitor's
  time zone, Apply button, `deadline.ics` download, series link
- `/series/`, `/niche/`, `/country/`, `/month/`, `/archive/`
- `/sources/` from the health log, `/subscribe/` with ICS feeds at
  `/calendars/all.ics` and `/calendars/<niche>.ics`
- `/sitemap.xml` (quality floor applied), `/robots.txt`, `/llms.txt`, Event JSON-LD
