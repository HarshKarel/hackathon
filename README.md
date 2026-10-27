# hackathon.so

A worldwide hackathon directory. Every hackathon gets one permanent page that
lives forever: status moves from upcoming to live to ended, and the page stays
published after the event ends.

Phase 1 built the data pipeline, the rewrite engine and the static site.
Phase 2 added Unstop and Kaggle as sources, a weekly winners pipeline, a guides
library and suggested guides on event pages. Phase 3 adds the project idea
feed with idea starters on event pages, a weekly idea generator, the "Claim
this listing" form with organiser fields, and moves both AI jobs to Gemini
3.8 Flash and its Batch API.

## Quick start

Requires Node.js 20 or newer.

```bash
npm install
npm run pipeline     # fetch every source, update data/events.json (about 11 min first run, 5 min after)
npm run build        # build the static site into _site/
npm run winners      # weekly winners check for recently ended events (about 10 min)
npm run ideas        # weekly: generate up to 10 idea cards for the thinnest niches (needs the AI key)
npm run backfill     # one-time: rewrite every placeholder description through the batch flow (needs the AI key)
npm run check        # verify the built site against the project rules
npm run serve        # local preview at http://localhost:8080
npm test             # unit tests
npm run test:claim   # browser test of the claim form (after a build with CLAIM_FORM_ENDPOINT set)
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
| `LLM_API_KEY` | A **Google AI Studio API key** (aistudio.google.com, "Get API key") for the Gemini API, used by the rewrite engine and the idea generator. The Batch API needs a project with billing enabled (paid tier). Sent only in the `x-goog-api-key` header; never logged or stored. |
| `LLM_MODEL` | The Gemini model id: **`gemini-3.8-flash`** (Gemini 3.8 Flash, generally available since 2 September 2026). The code reads the model only from this variable; it is not hardcoded anywhere. |
| `CLAIM_FORM_ENDPOINT` | Read at build time. The form endpoint that emails "Claim this listing" requests to you, for example a Formspree form URL `https://formspree.io/f/<form id>`. |
| `KAGGLE_USERNAME`, `KAGGLE_KEY` | Optional Kaggle API credentials. Without both, the Kaggle adapter is skipped with one line in the health log. |

Copy `.env.example` and export the values, for example:

```bash
export LLM_API_KEY=...                # your Google AI Studio key; leave unset for flagged placeholders
export LLM_MODEL=gemini-3.8-flash
npm run pipeline
```

If either AI variable is missing the pipeline still builds everything and
writes clearly flagged placeholder descriptions made only from the facts.
Event pages show a notice and placeholders do not count towards the quality
score.

For the weekly ideas workflow, add `LLM_API_KEY` as a repository **secret**
and `LLM_MODEL` as a repository **variable** (Settings, Secrets and variables,
Actions).

## How it works

```
pipeline/
  adapters/     one module per source: devpost, devfolio, unstop, mlh, hackerearth, ethglobal, hackclub, kaggle, seed
  lib/http.mjs  polite fetch: bot user agent, robots.txt check, one request per second per site (subdomains share it), retries
  lib/record.mjs   normalise a listing into the record (docs/RECORD_FORMAT.md)
  lib/dedupe.mjs   pass 1 exact source id, pass 2 normalised title + organiser + start date
  lib/store.mjs    permanent store with stable slugs and redirects
  lib/series.mjs   series from source data, or from titles that differ only by year/edition
  lib/rewrite.mjs  facts hash, AI rewrite requests, checks, retry round, review flag, placeholders
  lib/gemini.mjs   Gemini REST client: generateContent, Batch API create, poll and results
  lib/aiflow.mjs   the shared batch flow for both AI jobs, run log (data/health/ai-runs.jsonl)
  lib/ideas.mjs    idea card format, validation, near-duplicate check, niche balance
  lib/health.mjs   per-run health log (data/health/runs.jsonl, data/health/latest.json)
  lib/winners.mjs  Devpost and Devfolio winners parsers, which events to check
  run.mjs          the listing pipeline entry point
  winners.mjs      the weekly winners pipeline (writes data/winners.json only)
  ideas.mjs        the weekly idea generator (writes data/ideas-generated.json and its logs only)
  backfill.mjs     one-time rewrite of every placeholder description
src/            Eleventy site (templates, data layer, CSS, small ES modules)
data/
  events.json        permanent event store (pipeline output)
  seed-events.json   hand-maintained events with no feed (docs/SEED_FORMAT.md)
  winners.json       winners per event, written only by the winners pipeline
  ideas-seed.json    30 hand-written idea cards (no script writes this file)
  ideas-generated.json  cards added by the weekly generator
  ideas-rejected.jsonl  every generated card that was rejected, with the reasons
  ai-pending.json    batch jobs a run stopped waiting for (collected by the next run)
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
| Unstop | `unstop.com/api/public/opportunity/search-result` (registration open and closed) plus `/api/public/competition/<id>` for the start date; sent with a browser user agent, which Unstop requires |
| Kaggle | Official API, `www.kaggle.com/api/v1/competitions/list` with Basic auth; typed as competitions; runs only with `KAGGLE_USERNAME` and `KAGGLE_KEY` |
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
2. Only new or changed events (and placeholders) need a rewrite.
3. **Batch flow** (`lib/aiflow.mjs`, shared with the idea generator):
   - all pending events of a run are collected first;
   - with 10 or more, they go to the **Gemini Batch API as one job**
     (`models/<LLM_MODEL>:batchGenerateContent`), which is polled every 30
     seconds until it finishes;
   - with fewer than 10, standard `generateContent` requests on the same
     model are used instead.
4. Every result goes through the same validators: 80 to 140 words with a
   one-line summary, no em dash, no full sentence shared with the source
   text, and no number, month or weekday that is not in the facts.
5. Rejected drafts get one retry round with the reasons (a second batch job,
   or standard requests when fewer than 10 are left). A second failure flags
   the event in `data/review-queue.json`; a never-published event stays
   unpublished until approved in `data/reviews.json`:

```json
{ "<slug>": { "decision": "approve", "factsHash": "<hash from the queue>", "summary": "...", "description": "..." } }
```

Every run appends one line to `data/health/ai-runs.jsonl` with each round's
mode, **batch job id**, item count, **accepted / rejected / failed counts**,
tokens and an estimated cost (at $0.75 per million input tokens and $3.75 per
million output tokens, thinking included; batch jobs are billed at half the
standard price, so the estimate is an upper bound). The listing pipeline's
health log carries the same summary.

A run waits up to 330 minutes for a batch job. A job still running after that
is recorded in `data/ai-pending.json`; the next run collects its results
(for events whose facts have not changed) instead of paying for them again.

#### One-time backfill

Every event built before an AI key was set still carries a flagged
placeholder description. To queue all of them for rewriting through the
batch flow, once:

```bash
export LLM_API_KEY=...            # Google AI Studio key (paid tier for the Batch API)
export LLM_MODEL=gemini-3.8-flash
npm run backfill -- --dry-run     # count what would be queued (no API calls)
npm run backfill                  # one batch job for all of them, then the retry round
npm run build && npm run check
```

It reads the store and the saved listing text (`.cache/source-text.json`,
filled by any listing pipeline run) and fetches no sources. Events with no
saved listing text are rewritten from their facts alone. Do not run it at
the same time as the listing pipeline; both write `data/events.json`.

### Winners pipeline

`npm run winners` is separate from the listing pipeline and runs weekly in
GitHub Actions (`.github/workflows/winners.yml`, Mondays 04:23 UTC, also
runnable by hand). For every event that ended in the last 60 days with no
winners yet, it checks the event's Devpost project gallery and Devfolio prize
list:

- Winners are stored as place, project name, project URL and team, copied
  exactly as the platform states them.
- Events with nothing published get `winnersStatus: "not published"` and are
  checked again the next week, until 60 days have passed.
- It reads `data/events.json` and writes only `data/winners.json` and
  `data/health/winners-*`, so it never conflicts with the listing pipeline.

The listing pipeline itself is not scheduled yet.

### Guides

Ten guides live in `src/guides/*.md`. Their titles, URLs, one-line
descriptions and draft flags are in `src/_data/guidesList.json`. A guide with
`"draft": true` shows a visible draft notice. Set it to `false` once
reviewed. All guides are in the sitemap and `/llms.txt`.

Event pages suggest 2 or 3 guides (rules in `src/_lib/suggest.js`): upcoming
events get preparation guides, events whose deadline is within 7 days get the
Devpost or Devfolio guide for their platform, live events get the demo and
pitch guides, and ended events get the after-the-event and judging guides.

### Project ideas

An idea card is one record (format in `docs/RECORD_FORMAT.md`): id, title,
one-line pitch, what it does (3 to 4 sentences naming the user, the core
action and the demo moment), 1 to 3 niches from the site's taxonomy, a
suggested stack, difficulty (`weekend-easy`, `weekend-medium`,
`weekend-hard`), team size fit (`solo-friendly`, `pair`, `team`) and its
source (`seed`, or `generated` with the generation date).

- `data/ideas-seed.json` holds 30 hand-written cards, at least 2 per niche.
- `/ideas/` lists every card with niche and difficulty filters; each card
  opens to its full detail. It is in the main navigation as "Ideas".
- Each event page shows up to 3 **idea starters** that share a niche with the
  event, preferring cards not already shown on an earlier edition of the same
  series (`src/_lib/ideas.js`). Ended events keep their ideas: a generated
  card only reaches an ended event if it existed before the event ended.

**Weekly generator** (`npm run ideas`, `.github/workflows/ideas.yml`,
Wednesdays 05:41 UTC): picks the 10 slots from the niches with the fewest
cards, sends them as one Gemini batch job, and checks every card in code
(format, length limits, no em dashes, the niche it was asked for). A card
whose title shares keywords with an existing card in the same niche (or whose
pitch is mostly the same words) is a near-duplicate and is rejected. A
rejected card is regenerated up to 2 times with the reasons; every rejection
goes to `data/ideas-rejected.jsonl` and `data/health/ideas-latest.json`, and
only accepted cards are published.

### Claim this listing

Every event page links to `/claim/?event=<slug>`, a short form (name,
organisation, email, what they want changed, plus the listing URL). It posts
to `CLAIM_FORM_ENDPOINT`, a form service that emails each request, so the site
needs no backend. Setup with Formspree: create a free form at formspree.io,
set the email address it delivers to, and build with
`CLAIM_FORM_ENDPOINT=https://formspree.io/f/<form id>`. Without JavaScript the
form posts directly to the endpoint; with it, the page shows a confirmation.
`npm run test:claim` checks the whole flow in a browser.

Event records carry two organiser fields for later: `featured` (default
`false`) and `claimedBy` (default empty). They are set by hand and never
changed by a source update. There are no payments and no organiser dashboard.

### Site

Built with Eleventy: it outputs plain HTML with no client framework, and data
pagination gives each event its own permanent URL. Pages:

- `/` open events sorted by deadline, search and filters (status, format,
  niche, country, deadline window, source), niche counts, Closing Soon rail
- `/hackathons/<slug>/` event page with status banner, key facts, original
  description, prize and eligibility as stated, deadline in the visitor's
  time zone, Apply button, `deadline.ics` download, series link
- winners on ended event pages, or "Winners not published yet" with the end date
- a "Prepare" or "Reflect" block of suggested guides on every event page
- `/guides/` with one-line descriptions, linked from the main navigation
- `/ideas/` the project idea feed with niche and difficulty filters
- "Idea starters for this hackathon" (up to 3 cards) on every event page
- `/claim/` the "Claim this listing" form (not indexed)
- `/series/`, `/niche/`, `/country/`, `/month/`, `/archive/`
- `/sources/` from the health log, `/subscribe/` with ICS feeds at
  `/calendars/all.ics` and `/calendars/<niche>.ics`
- `/sitemap.xml` (quality floor applied; includes the guides and ideas
  sections), `/robots.txt`, `/llms.txt` (lists every guide and idea), Event JSON-LD
