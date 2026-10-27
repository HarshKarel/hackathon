# Phase 1 report

Built: the data pipeline (six source adapters plus a hand-maintained seed),
the rewrite engine, and the static site. Nothing is deployed.

**No `LLM_API_KEY` was available in the build sandbox.** Every description
on the site is therefore a clearly flagged placeholder assembled from the
facts. The AI rewrite path is implemented and unit-tested against a stubbed
API, but it has not been run against a live model.

Numbers below come from two live runs on 27 Oct 2026: run A started from an
empty store (06:23 to 06:34 UTC) and run B was the next, incremental run
(06:49 to 06:54 UTC).

## 1. Counts per source

Run A, the full first run:

| Source | Read | Normalised | Item errors | Events on site (any source) | Events where it is the apply link | Fetch time |
| --- | --- | --- | --- | --- | --- | --- |
| Devpost | 454 (174 open or upcoming, 280 ended in the last 60 days) | 454 | 0 | 407 | 407 | 649 s (454 detail pages at 1 request per second) |
| Devfolio | 128 | 128 | 0 | 69 | 69 | 30 s |
| MLH | 87 (2027 season; 2028 page not published yet) | 87 | 0 | 87 | 70 | 3 s |
| HackerEarth | 2 events in feed, both hackathons | 2 | 0 | 2 | 2 | 2 s |
| ETHGlobal | 345 events on page, 82 hackathons kept (meetups, summits and cafes skipped; 1 cancelled) | 82 | 0 | 3 | 3 | 3 s |
| Hack Club | 918 (full history back to 2016) | 918 | 0 | 31 | 24 | 5 s |
| Seed (curated) | 3 | 3 | 0 | 3 | 3 | 0 s |

- 1,674 listings became 1,641 distinct events after dedupe (33 merges).
- 578 events went into the store. The other 1,063 were ended events
  outside the 60-day back-fill window, mostly Hack Club and ETHGlobal history.
- Status at run time: 202 upcoming, 53 live, 323 ended. 24 events have more
  than one source.
- Quality: 221 events score 80, 258 score 60, and 99 score 40. The 99 at 40
  are built with `noindex` and left out of the sitemap. With placeholders no
  event can score 100, because the description check only counts an
  approved original text.

Run B, the incremental run, read 1,438 listings in 5.4 minutes:
- Devpost re-read only its 173 open and upcoming events and skipped 235
  ended ones already stored.
- 350 listings matched existing pages by exact source id.
- 0 new events, 0 pages merged or redirected.
- **0 events had changed facts.**
- One event moved from live to ended as time passed.

The per-run health log is in `data/health/runs.jsonl` and
`data/health/latest.json`. The public `/sources/` page reads it.

## 2. Three worked dedupe examples

**a) hackPHS 2026: three listings, one page (pass 2).**

| Listing | Title | Organiser | Start |
| --- | --- | --- | --- |
| `devpost:31110` | hackPHS 2026 | Princeton High School | 2026-10-10T04:00Z |
| `mlh:01a0435f…` | hackPHS | not stated | 2026-10-10T13:00Z |
| `hackclub:0qnIzD` | hackPHS | not stated | 2026-10-10T14:00Z |

- Normalised title is `hackphs` for all three (case and year removed). Start
  days match, and only Devpost states an organiser, so it cannot conflict.
- Result: one page, `/hackathons/hackphs-2026/`, keeping all three sources.
- Facts follow source priority. Devpost supplies the title, prize
  ($1,050 in prizes), deadline and apply link. MLH and Hack Club stay as
  extra sources.

**b) SpartaHack 12 on Devpost and SpartaHack on MLH (pass 2, edition number ignored).**

| Listing | Title | Organiser | Start |
| --- | --- | --- | --- |
| `devpost:30608` | SpartaHack 12 | SpartaHack | 2027-02-06T17:00Z |
| `mlh:019f3cb6…` | SpartaHack | not stated | 2027-02-06 |

- MLH drops edition numbers, so the first version of pass 2 missed this
  pair. Titles are now compared without years or edition markers ("12",
  "13.0", "9.O", "V5"), and the pair merges.
- Guard rails still apply: start dates must be within a day, stated
  organisers must agree, and stated countries must agree. A unit test checks
  that two same-named events in different countries do not merge.
- Other merges of the same kind in this run: Cal Hacks 13.0 (Devpost and
  MLH) and OCSEFHacks 3 / OCSEFhacks (Devpost and Hack Club).

**c) Pass 1, exact source id, across runs.**

- Within one run, pass 1 found no pairs: each platform lists an event once.
  It merges inside a run when a seed declares a platform id (see
  `docs/SEED_FORMAT.md`, covered by a test).
- Its everyday job is across runs. In run B, 350 listings were
  matched to their existing pages by exact `platform:sourceId`, so no slug
  changed.
  - Example: `ethglobal:527` maps to `/hackathons/ethglobal-mumbai-2026/`.
  - Example: hackPHS's three ids above all map to `/hackathons/hackphs-2026/`.
- If two stored pages are later found to be one event, the newer URL
  becomes a redirect to the older one, preferring a page that is already
  published. Tests cover this; no real case occurred in these runs.

## 3. Three before/after rewrite samples

These are **placeholder** rewrites: no AI key was available. "Before" is the
start of the listing's own text, which we never publish. "After" is what the
site shows, built only from facts. Checks were run with the same code the AI
path uses (`sharedSentences`, `factProblems`).

**BioHacks (Devpost and MLH)**
- Before (Devpost): "Welcome to BioHacks Fall 2026, hosted by BioEng4Youth!
  This interdisciplinary bio-engineering hackathon challenges you to bridge
  the gap between biology, technology, and engineering..."
- After: "BioHacks is an in-person hackathon in Hamilton, Canada, organised
  by BioEng4Youth. It runs from 7 November 2026 to 8 November 2026. The
  listed submission deadline is 8 November 2026. Full details and
  registration are on Devpost and MLH."
- Facts: start 2026-11-07, end 2026-11-08, deadline 2026-11-08 (submission),
  Hamilton, Canada.
- Shared sentences: 0. Longest shared word run: 2 ("biohacks is").
  Numbers or months not in the facts: none.

**CODERAVE 2.0 (Devfolio)**
- Before: "CODE • COLLABORATE • INNOVATE - The SLIET Annual Hackathon.
  CODERAVE 2.0 National-Level Hybrid Hackathon Organized by Internwell SLIET
  Club..."
- After: "CODERAVE 2.0 is an in-person hackathon. It runs from 13 February
  2027 to 14 February 2027. The listed registration deadline is 15 January
  2027 (18:29 UTC). Full details and registration are on Devfolio."
- Facts: start 2027-02-13T11:30Z, end 2027-02-14T11:30Z, registration
  deadline 2027-01-15T18:29Z.
- Shared sentences: 0. Longest shared run: 4 ("coderave 2 0 is", the name).
  Facts check: clean.
- **Source conflict:** Devfolio's structured fields say in-person, but its
  own description says hybrid. We follow the structured field. See
  "Unverified" below.

**Cosmo Hacks 2026 (Devpost and Hack Club)**
- Before: "Cosmo Hacks is a free month-long online hackathon for middle
  school, high school, and college students aged 13+, taking place from
  December 19, 2026 to January 18, 2027..."
- After: "Cosmo Hacks 2026 is an online hackathon, organised by Cosmo Hacks.
  It runs from 19 December 2026 to 18 January 2027. The listed submission
  deadline is 18 January 2027. Full details and registration are on Devpost
  and Hack Club."
- Facts: start 2026-12-19, end 2027-01-18, deadline 2027-01-18
  (submission), prize "$146,700 in prizes" (shown in its own section, as
  stated).
- Shared sentences: 0. Longest shared run: 3 ("cosmo hacks 2026", the
  name). Facts check: clean.

Placeholders are about 40 to 55 words and do not meet the 80 to 140 word
target, which applies to AI output. They are labelled on every page
("Placeholder description: assembled automatically from the listed facts")
and do not count towards the quality score.

With a key, AI output must pass these checks or it is retried once and then
flagged for review:
- 80 to 140 words, plus a one-line summary
- no em dash
- no full sentence shared with the source text
- no number, month or weekday that is not in the facts

## 4. AI calls per full run

- **0**, because `LLM_API_KEY` was not set. The health log records why:
  `"reason": "LLM_API_KEY is not set"`.
- With a key, run A would have made **578 calls** (one per new event). At
  most 1,156, since each event gets one retry.
- The incremental run B had 0 events with changed facts, so it would have
  made 0 calls. Unchanged events are never re-sent: the facts hash decides.
- An API outage no longer hides events. Events get a flagged placeholder and
  are retried on the next run, instead of being flagged for review.

## 5. Screenshots

- `docs/screenshots/home-desktop.png` (1280 px)
- `docs/screenshots/home-phone.png` (390 px)
- `docs/screenshots/event-desktop.png` (1280 px, full page)
- `docs/screenshots/event-phone.png` (390 px, full page)

At both widths: no horizontal scroll and no console errors. The deadline
"in your time" line was rendered with the browser set to America/New_York.

## 6. Unverified, or worth knowing

- **AI rewrites never ran against a real API.** The prompt, JSON parsing,
  retry, review flag and outage handling are covered only by tests with a
  stub. The first real run should be watched, and `review-queue.json`
  checked afterwards.
- **Seed facts come from web search, not the official sites.**
  spaceappschallenge.org failed TLS and returned 503 to this sandbox, and
  sih.gov.in returned 403.
  - NASA Space Apps 2026 (14 to 15 Nov 2026), Space Apps 2025 (4 to 5 Oct
    2025) and SIH 2025 (finale 8 to 12 Dec 2025, ₹1,50,000 per winning team
    in the software edition) are from search summaries of the official
    pages and news reports.
  - Each entry carries a `notes` field saying so.
  - **SIH 2026 is not seeded**: national finale dates were only "proposed
    for December 2026".
- **Devpost deadlines are submission deadlines.** Devpost does not state a
  separate registration deadline; you can join until submissions close.
  The record keeps it in `registrationDeadline` with
  `deadlineKind: "submission"`, and the site labels it "Submissions close".
- **Devpost start times are the submission-period start.** These come from
  the page's own JSON-LD, so a merged event can show Devpost's 04:00 UTC
  start rather than MLH's 13:00 UTC (hackPHS).
- **MLH and Hack Club state no deadlines.** About 100 events show "No
  deadline stated" and sort after events with deadlines. MLH states no
  eligibility per event, so its events are tagged with the Student niche
  but their eligibility value is left empty.
- **Inferred values, documented in code:**
  - HackerEarth mode is set to online, since its hackathons run on its
    platform. The feed does not say so per event.
  - Hack Club eligibility is set to `students`, from the directory's
    high-school scope.
  - Devfolio and ETHGlobal flags are taken as stated, even when a
    description disagrees (CODERAVE 2.0).
- **The Hack Club apply button goes to the event's own website.** The
  directory has no page per event, so the button reads "Apply via Hack Club
  listing".
- **Date-only values have no time zone.** A deadline counts until its day
  has ended everywhere (UTC-12), or until local midnight when the source
  states a time zone. The page says when only a date was given.
- **Pass-2 dedupe is a heuristic.** Infinity Hacks (Devfolio, no organiser)
  merged with Infinity Hacks (Devpost, "hacker rank"), one day apart. That
  is plausible but not confirmed by a human.
- **robots.txt:** ETHGlobal and Hack Club return 404, which means no rules,
  so we crawl them. MLH, Devpost, Devfolio and HackerEarth allow our paths.
  The crawler checks robots.txt before every request and refuses when it
  cannot read it.
- **Not built (out of scope):** deployment, scheduling, a production domain
  and any API keys.
- A separate code review found 9 bugs during the build. All are fixed and
  each has a test. The suite has 57 tests.
