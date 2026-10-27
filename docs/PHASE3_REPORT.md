# Phase 3 report

Phase 3 is built and tested. It adds:
- the project idea feed, with 30 seed cards and idea starters on every event page
- the weekly idea generator, with a GitHub Actions schedule
- the move of both AI jobs to Gemini 3.8 Flash and its Batch API
- a one-time backfill command for placeholder descriptions
- the "Claim this listing" form and the organiser fields
- the guides and ideas sections in the sitemap and `/llms.txt`

Nothing is deployed.

**No real Gemini batch run happened.** `LLM_API_KEY` is not set in this
environment, so I could not run a real batch job or produce real rewrites.
Section 5 shows what was verified instead and the exact commands for the
first real run.

## 0. Starting state (summarised before any change)

- **Listing pipeline:** 9 sources and 869 events in `data/events.json`.
  - The rewrite engine used the Anthropic SDK, one request per event.
  - No key was ever set, so **all 869 descriptions were placeholders**.
  - The pipeline is not scheduled.
- **Winners pipeline:** runs weekly in GitHub Actions.
- **Guides:** 10 drafts, kept out of search engines.
- **Data model:** no ideas, and no `featured` or `claimedBy` fields.
- **Niche list:** fixed at 13 niches.

## 1. The 30 seed cards, by main niche

All 30 pass the same validator the generator uses (`validateIdea`). None is
a near-duplicate of another.
- Every niche is the main niche of at least 2 cards. Counting secondary
  niches, Web3 and Gaming have 2 cards each and AI and ML has 10.
- Difficulty: 12 weekend-easy, 12 weekend-medium, 6 weekend-hard.
- Team size: 10 solo friendly, 15 pair, 5 team.

Each card names the user, the core action and the demo moment. The last
sentence always starts "In the demo,".

| Main niche | Cards (difficulty, team size) |
| --- | --- |
| AI and ML | Fridge Photo Meal Planner (easy, solo friendly); Webcam Fingerspelling Tutor (hard, team); Alt Text Assistant for Editors (medium, pair) |
| Web3 | QR Check-in Attendance Tokens (medium, pair); Teen Allowance Smart Wallet (hard, team) |
| Fintech | Subscription Leak Finder (easy, solo friendly); Receipt Photo Bill Splitter (medium, pair) |
| Health | Text Reminders for Older Relatives (easy, solo friendly); Walk-in Clinic Queue Texts (easy, pair); Home Physio Rep Counter (hard, team) |
| Climate | Commute Swap Planner (medium, pair); Cafe Surplus Food Matcher (easy, pair) |
| Design | Contrast Fixer for Figma (medium, solo friendly); Paper Sketch to Clickable Prototype (hard, team) |
| Data Science | Bus Bunching Map (medium, pair); My Street Air Quality Story (easy, solo friendly) |
| Hardware | Rain Barrel Level Alert (easy, solo friendly); Standby Power Spy (medium, pair); Visual Alerts for Doorbell and Alarms (hard, team) |
| Gaming | Two-Phone Co-op Puzzle (hard, pair); Translate to Defend (easy, solo friendly) |
| Social Impact | Official Letter Explainer (medium, pair); Volunteer Shift Swap Board (easy, solo friendly) |
| Student | Lecture Slides to Flashcards (easy, solo friendly); Group Project Contribution Tracker (medium, pair); Free Study Room Finder (easy, pair) |
| Enterprise | Incident Timeline Bot for Slack (medium, pair); Contract Renewal Radar (medium, solo friendly) |
| Open | Neighbourhood Tool Library (easy, pair); Lost Property Photo Matcher (medium, pair) |

The full cards are in `data/ideas-seed.json` and on `/ideas/`.

## 2. Idea feed and event matching

**`/ideas/`** (in the main navigation as "Ideas"):
- All cards, newest first.
- Niche and difficulty filters, kept in the address
  (`/ideas/?niche=health&difficulty=weekend-easy`), so event pages can link
  to a filtered feed.
- Each card opens to its full detail and has its own link
  (`/ideas/#idea-<id>`).
- Without JavaScript every card is shown and the filters stay hidden.

**Idea starters** on each event page (`src/_lib/ideas.js`): up to 3 cards that
share at least one niche with the event, ranked:
1. cards not already shown on an earlier edition of the same series
2. more niches in common
3. the card's main niche is one of the event's niches
4. a stable per-event shuffle, so similar events show different cards

**Ended events keep their ideas.** A generated card only reaches an ended
event if it existed on the day the event ended, so new cards never replace
what an ended page showed. Seed cards are available to every event.

Today 863 of 869 events show 3 starters. The other 6 are Web3-only events
that show 2, because only 2 cards are tagged Web3. Web3 is the generator's
first target.

**Three example pages:**

| Event | State | Event niches | Idea starters |
| --- | --- | --- | --- |
| [AI for Human Impact: A Global BASIS Hackathon](/hackathons/ai-for-human-impact-a-global-basis-hackathon-2027/) | upcoming | AI and ML, Social Impact, Health | Official Letter Explainer; Home Physio Rep Counter; Alt Text Assistant for Editors |
| [NASA International Space Apps Challenge 2026](/hackathons/nasa-international-space-apps-challenge-2026/) | upcoming, series | Data Science, Climate, Open | Bus Bunching Map; Cafe Surplus Food Matcher; Lost Property Photo Matcher |
| [HelloHacks](/hackathons/hellohacks-2026/) | ended, with winners | Open | Neighbourhood Tool Library; Lost Property Photo Matcher; Receipt Photo Bill Splitter |

The NASA 2026 page shows the sibling rule at work:
- The 2025 edition already shows My Street Air Quality Story, Neighbourhood
  Tool Library and Commute Swap Planner.
- So 2026 picks three different cards, even though two of the 2025 cards
  match more of its niches.

Screenshots: `docs/screenshots/idea-starters-desktop.png` and
`idea-starters-phone.png` (the section), `idea-starters-page-*.png` (the
whole page), and `ideas-feed-desktop.png` and `ideas-feed-phone.png`.

## 3. AI pipeline: Gemini 3.8 Flash and the Batch API

**Model.** `LLM_MODEL=gemini-3.8-flash`.
- It has been generally available since 2 September 2026, per Google's
  models page and changelog, read today.
- The code reads the model only from `LLM_MODEL`.
- `LLM_API_KEY` is described everywhere as a Google AI Studio key. It is
  sent only in the `x-goog-api-key` header.
- The Anthropic SDK is removed.

**One flow for both AI jobs** (`pipeline/lib/aiflow.mjs`):
- All pending items of a run are collected first.
- With 10 or more, they go to the Batch API as **one job**
  (`models/gemini-3.8-flash:batchGenerateContent`), polled every 30 seconds
  until it finishes.
- With fewer than 10, it uses standard `generateContent` requests on the same
  model.
- Results go through the existing validators: no em dashes, no full
  sentence shared with the source text, facts unchanged, and length limits.
- Rejected drafts get one retry round with the reasons.
- Requests ask for JSON output, use the lowest thinking level Gemini 3.8
  Flash allows (`LOW`; it cannot switch thinking off), and set
  `store: false` so Google does not keep request logs.

**Logs.** Every run appends a line to `data/health/ai-runs.jsonl`. For each
round it records:
- the mode and batch job id
- the item count
- accepted, rejected and failed counts
- tokens and an estimated cost at $0.75 in and $3.75 out per million tokens,
  with thinking counted as output

The listing pipeline's health log carries the same summary.

**Long batch jobs.** A run waits up to 330 minutes for a batch job.
- A job still running after that is saved in `data/ai-pending.json`.
- The next run collects its results instead of paying for them again.
- Results are used only for events whose facts have not changed since.

**Backfill** (`npm run backfill`, documented in the README):
- Queues every event still carrying a placeholder description: **869
  today, 769 of them with saved listing text**.
- `--dry-run` counts without calling the API.
- It fetches no sources. Events without saved listing text are rewritten
  from their facts alone.

## 4. Generation pipeline: duplicate-check evidence

`npm run ideas`, scheduled by `.github/workflows/ideas.yml` (Wednesdays 05:41
UTC):
- It plans 10 slots in the thinnest niches. Today that is Web3 ×3, Gaming ×2,
  Design ×2, Hardware ×2 and Fintech ×1, with difficulty and team size varied.
- The first round is one batch job; regenerations use standard requests.
- Each card is checked in code: format, length limits, no em dashes, and the
  niche, difficulty and team size it was asked for.
- A near-duplicate is rejected: it shares a niche with an existing card
  and either shares title keywords with it or its pitch mostly uses the
  same words.
- A rejected card is regenerated up to 2 times with the reasons.
- Every rejection is written to `data/ideas-rejected.jsonl` and
  `data/health/ideas-latest.json`. Only accepted cards are published.

**One rejected card and why.** This comes from the end-to-end test of the
generator (`tests/ideas.test.mjs`). It runs the real generator code against a
stand-in for the Gemini API, because no real generation run was possible.
- **Card:** "QR Check-in Attendance Badges" (Web3). Pitch: "Attendees scan a
  QR code at the door to collect an attendance badge on a testnet."
- **Logged reason:** `near-duplicate of "QR Check-in Attendance Tokens"
  (qr-check-in-attendance-tokens): same niche Web3, shared title keywords:
  qr, check, attendance`
- **Outcome:** regenerated in round 2 (standard request); the new card was
  accepted.

The same test also covers a card that kept using an em dash. It was rejected
three times, logged as final, and not published.

## 5. Batch run evidence

**No real batch run was possible here** (no `LLM_API_KEY`), so there is no
real job id and there are no real rewrites to show. I did not make any up.
What was verified instead:

- **REST shapes.** 10 tests run the real client against a fake Gemini API:
  - the exact URLs, the key header, and the batch request body
  - polling until done, and results matched back by key
  - `BATCH_STATE_*` and `JOB_STATE_*` state names
  - failed and slow jobs, and retries on 429 rate-limit errors
  - the cost formula
  - collecting a job an earlier run left running
  
  The REST shapes come from Google's API reference, read today.
- **Full-size simulation.** The real backfill code ran on a scratch copy of
  the data against the fake API:
  - all **869 events went into one batch job**;
  - the request body was **3.1 MB** (Google's inline limit is 20 MB);
  - every result went through the validators.
  
  The text was made by the fake API and was not kept.
- **Cost estimate for the real backfill**, from the actual prompts: about
  **644,000 input tokens**.

  | Output per event | At $0.75 in / $3.75 out per million | Batch price (half) |
  | --- | --- | --- |
  | about 180 tokens (answer only) | $1.07 | $0.53 |
  | about 600 tokens (answer plus low thinking) | $2.44 | $1.22 |
  | about 1,500 tokens | $5.37 | $2.69 |

  Google's pricing page lists exactly $0.75 / $3.75 as the standard
  introductory price for Gemini 3.8 Flash until 31 December 2026, and half
  that for batch jobs. From 1 January 2027 the prices double.
- **A weekly idea run** is about 7,000 input tokens, so it costs about $0.02
  to $0.08.

**To get the real evidence:**
1. Add `LLM_API_KEY` (a Google AI Studio key from a paid-tier project; the
   Batch API is not on the free tier) and `LLM_MODEL=gemini-3.8-flash` to
   the environment.
2. Run `npm run backfill`, then `npm run build && npm run check`.

The job id, counts and cost will be in `data/health/ai-runs.jsonl`, and the
rewrites in `data/events.json`.

## 6. Claim form

- Every event page has a "Claim this listing" link to
  `/claim/?event=<slug>`. The page is not indexed.
- The form asks for name, organisation, email and what they want changed,
  plus the listing URL, which is filled in from the link. It also has a
  spam trap field.
- It posts to `CLAIM_FORM_ENDPOINT`, a Formspree form that emails each
  request, so there is no backend of ours.
- Without the variable, the page says the form is not connected and the
  site check notes it.
- Organiser fields: `featured` (default `false`) and `claimedBy` (default
  empty). All 869 events have them, and source updates never change them
  (tested).

**Test result: 19 of 19 checks passed** (`npm run test:claim`, results in
`docs/claim-form-test.json`). The browser test:
- follows the link from an event page;
- checks that the listing, event title and email subject are filled in;
- checks that empty fields and a bad email are blocked;
- sends a valid form once, with every field and a JSON reply, and checks the
  confirmation;
- checks that an error from Formspree is shown and the form can be resent;
- checks that the form still posts directly without JavaScript;
- checks that the page fits a 390 px phone screen.

Requests to Formspree were intercepted, so **no real email was sent**.

Screenshots: `docs/screenshots/claim-form-desktop.png`,
`claim-form-sent.png` and `claim-form-phone-nojs.png`.

## 7. Sitemap and llms.txt

- **Sitemap:** now includes `/ideas/`, `/guides/` and all 10 guides.
  - To list them, I removed the guides' `noindex`. They still show their
    "Draft" notice until you set `"draft": false`.
  - If you would rather keep drafts out of search until review, that is a
    one-line revert.
- **`/llms.txt`:** lists every idea card with its pitch, niches, difficulty
  and team size, plus the guides, and explains the idea starters.

## 8. Unverified, or worth knowing

- **No real Gemini call was made.** There is no key in this environment. The
  REST field names come from Google's API reference and are covered by
  tests against a fake API, but the first real run should be watched. These
  details are documented but untested live:
  - the uppercase `LOW` thinking level;
  - `responseJsonSchema` inside batch requests;
  - the `store` field.
- **The Batch API needs a paid-tier project.** Google lists it as
  unavailable on the free tier. On Tier 1, the limit on tokens queued at
  once for Gemini 3.8 Flash is 3,000,000; the backfill needs about 644,000.
- **The weekly ideas workflow has not run on GitHub.**
  - It runs from `main` and needs the `LLM_API_KEY` secret and the
    `LLM_MODEL` variable.
  - Without them it fails with a clear message rather than skipping
    silently.
- **No real claim was delivered.** That needs a Formspree form of yours set
  as `CLAIM_FORM_ENDPOINT` when the site is built.
- **The listing pipeline is still unscheduled**, as before.
- **The near-duplicate check is keyword-based.** It catches renamed copies
  (as in section 4) but not the same idea under completely different words.
  The prompt also lists every existing card to steer the model away from
  repeats.
- **Seed cards are mine**, written today. Like the guides, they are worth a
  read for tone and accuracy. Stack suggestions name real tools (Twilio,
  OpenAQ, MediaPipe, Figma Plugin API and others) but were not each checked
  for current pricing.
