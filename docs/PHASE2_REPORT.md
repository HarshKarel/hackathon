# Phase 2 report

Phase 2 is built and run against live sources. It adds:
- two sources: Unstop (live) and Kaggle (credentials not available)
- a weekly winners pipeline with a GitHub Actions schedule
- winners and suggested guides on event pages
- a library of 10 guides, all **drafts for your review**

Nothing is deployed. The idea feed (Phase 3) is not started.

Numbers come from live runs on 27 Oct 2026: the listing pipeline from 07:15 to
07:25 UTC, then the winners pipeline from 07:26 to 07:29 UTC.

## 0. Starting state (summarised before any change)

**Pipeline:**
- Phase 1 on `main` had six source adapters plus the seed, a permanent store
  (`data/events.json`, 578 events), two-pass dedupe and the rewrite engine.
  Every description was a flagged placeholder, because no AI key is set.
- The health log feeds the Sources page.
- There was no `type` field and no winners data.
- There was no `.github/workflows` folder, so the "twice-daily listing
  pipeline" is **not scheduled anywhere yet**. I kept that out of scope, and
  the winners workflow is built to be independent of it.

**Site:** Eleventy, with `njk` and `11ty.js` templates and no Markdown yet.

## 1. New sources

| | Unstop | Kaggle |
| --- | --- | --- |
| How it is read | Public JSON at `unstop.com/api/public/…`, which robots.txt allows. A browser user agent is sent on every request, as Unstop requires. | Official API (`www.kaggle.com/api/v1/competitions/list`, HTTP Basic auth) |
| Run result | OK | Skipped, because `KAGGLE_USERNAME` and `KAGGLE_KEY` are not set. This is one line in `data/health/latest.json`; nothing printed and no error. |
| Listings read | 291 (196 with registration open, 95 with registration closed but not ended) | 0 |
| Normalised / errors | 291 / 0 | 0 / 0 |
| On the site | 291 events, all with Unstop as the apply link. None merged with another source. | 0 |
| Typed as competition | 18 (capture the flag, bug bounty and quiz listings) | All Kaggle listings would be |
| Sources page | Listed with what it covers and last fetch time | Listed as "Not run: KAGGLE_USERNAME and KAGGLE_KEY are not set" |

Unstop events by format: 140 online, 119 in person, 32 hybrid. Other Unstop
facts read: eligibility tags (`students` 108, `open` 77, `mixed` 9), team
size and prizes. The store now holds **869 events**: 851 hackathons and 18
competitions.

## 2. Winners

**How it works:**
- `npm run winners` (`pipeline/winners.mjs`) is separate from the listing
  pipeline.
- It reads `data/events.json` and writes only `data/winners.json` and
  `data/health/winners-*`.
- `.github/workflows/winners.yml` runs it every Monday at 04:23 UTC (or by
  hand) and commits those files back.

**First run:**
- 322 events ended in the last 60 days.
  - 287 are listed on Devpost or Devfolio. All 287 were checked, with 0
    errors.
  - The other 35 (19 MLH, 14 Hack Club, 2 ETHGlobal) have no platform we can
    read winners from, so they show no winners section.
- **18 events gained winners** (14 from Devpost, 4 from Devfolio), with 121
  winner rows in total.
- **269 events are honestly "not published"**, and their pages say so with
  the end date.
- **Cross-check:** for the 235 checked events whose Devpost
  `winners_announced` flag we also hold, our published or not-published
  result matches Devpost's own flag in **235 of 235** cases.

**Three events with winners** (copied exactly as the platform states them):

| Event | Source | Ended | Winners (first rows) |
| --- | --- | --- | --- |
| [HelloHacks](/hackathons/hellohacks-2026/) | Devpost | 27 Sep 2026 | 7 rows. 1st Place: *Fitting Room* (Samuel Zhu, Daniel Wang, Omai56 Mai, weooly). 2nd Place: *Huddle*. 3rd Place: *hopped*. |
| [Emberhacks Day 2026](/hackathons/emberhacks-day-2026/) | Devpost | 19 Sep 2026 | 3 rows. 1st Place: *SketchQuest*. 2nd Place: *Paper Machine*. 3rd Place: *ChromaJam*. |
| [Recursive](/hackathons/recursive-2026/) | Devfolio | 8 Oct 2026 | 5 rows. The Winner: *gps-denied car* (team FINE TUNE). 1st Runner UP: *Northern Star* (Dhruv Tara). 2nd Runner Up: *SwarSanket* (NEMESIS). |

**Three events with winners not published:**

| Event | Checked | Ended | Page shows |
| --- | --- | --- | --- |
| [Cal Hacks 13.0](/hackathons/cal-hacks-13-0-2026/) | Devpost (also listed on MLH) | 25 Oct 2026 | "Winners not published yet. This event ended on Sun, 25 October 2026." |
| [DuQuantum 2026](/hackathons/duquantum-2026/) | Devpost (also listed on MLH) | 25 Oct 2026 | Same wording, with its own date |
| [ALGOTHON'26](/hackathons/algothon-26-2026/) | Devfolio | 4 Oct 2026 | Same wording, with its own date |

Each "not published" page also says when and where we last checked. Events
are re-checked weekly until 60 days after they end.

## 3. Guides (all drafts)

All 10 are marked `"draft": true` in `src/_data/guidesList.json`.
- Each page shows a draft notice, carries `noindex`, and stays out of the
  sitemap until you set the flag to `false`.
- The guides index is linked from the main navigation and shows a one-line
  description for each guide.

| # | Title | Words | Facts checked against |
| --- | --- | --- | --- |
| a | How to choose the right hackathon | 917 | General advice; site features described as built |
| b | How to pick a problem statement | 764 | General advice |
| c | How to form a team that works | 688 | Devpost and Devfolio team mechanics (help pages below) |
| d | How to plan 48 hours | 747 | Devpost "edit until the deadline" (help page) |
| e | How to build a demo that lands | 721 | Devpost video hosting rule; Devfolio "YouTube preferred" |
| f | How to pitch to judges | 662 | Criteria counts from 454 Devpost pages and 128 Devfolio listings in our data |
| g | How judging usually works | 739 | Devpost "how hackathons work" and submission-steps pages; our criteria counts |
| h | How to apply on Devpost, step by step | 811 | Devpost Help Center articles 119, 122, 126 and 307, read 27 Oct 2026 |
| i | How to apply on Devfolio, step by step | 843 | Devfolio guide: hackathon modes, application review, teams, project submission (27 Oct 2026) |
| j | What to do after a hackathon ends, win or lose | 589 | Devfolio "projects appear on your profile" |

The platform guides list their sources at the bottom of the page. Word counts
are body text only, excluding the title and lede.

**Suggested guides** (`src/_lib/suggest.js`, 2 or 3 per event page):

| Event state | Block | Guides |
| --- | --- | --- |
| Ended | Reflect | After it ends, How judging works |
| Live | Prepare | Demo, Pitch. With a deadline within 7 days on Devpost or Devfolio, that platform's guide comes first. |
| Upcoming, deadline within 7 days, on Devpost or Devfolio | Prepare | Platform guide, Team, Plan |
| Upcoming, deadline within 7 days, other platform | Prepare | Team, Plan, Problem |
| Upcoming, starts within 7 days | Prepare | Plan, Team, Problem |
| Upcoming, otherwise | Prepare | Choose, Problem, Team |

## 4. Screenshots

In `docs/screenshots/`. None scrolls sideways and there are no console
errors at either width.
- `winners-event-desktop.png` and `winners-event-phone.png`: HelloHacks,
  with winners and the Reflect block.
- `guides-event-desktop.png` and `guides-event-phone.png`: Surat Hack 2026,
  upcoming with its deadline within 7 days. The Prepare block shows the
  Devfolio guide, then Team and Plan.
- `winners-not-published-desktop.png`: Cal Hacks 13.0.
- `guides-index-desktop.png`.

## 5. Unverified, or worth knowing

- **Kaggle never ran against the real API.** There are no credentials here.
  The endpoint and auth come from Kaggle's published API spec. The response
  field names (`ref`, `deadline`, `newEntrantDeadline`, `reward`,
  `maxTeamSize`, `enabledDate`) are **not** defined in that spec. They come
  from the official client's known output and are handled defensively. The
  first credentialed run should be checked.
- **Unstop's start dates.** Unstop's stated competition start is usually
  the opportunity's start, not the hackathon round. So all 291 Unstop events
  are currently "live", matching Unstop's own LIVE label. Round dates are not
  read.
- **Unstop competitions are our own classification.** Capture the flag, bug
  bounty and quiz listings are typed as competitions by their titles.
- **Unstop history is not back-filled.** Its "expired" list is not sorted by
  date, so recently ended Unstop events were not added. New events enter the
  store while open and stay there.
- **Winners places.**
  - Devpost: the place is the prize name on the winning project's page.
    Some organisers name prizes after the item (Marina Hacks lists a drone
    model), and that is shown as stated.
  - Devpost: the team is the "Created by" names; some are usernames.
  - Devfolio: the team is the team name, and some winning teams have none,
    shown as "Not stated".
- **Em dashes in winners.** Names are copied exactly, including any em
  dashes (there are none today). The site check exempts only the winners
  table.
- **The first winners run went faster than intended.** Each Devpost
  hackathon has its own subdomain, and the rate limiter treated them as
  separate sites. For about 3 minutes it sent up to about 4 requests a second
  to Devpost. This is now fixed and tested: limits are shared across
  subdomains, so the weekly run will take about 11 minutes.
- **The workflow has not run on GitHub yet.** Scheduled workflows only run
  from the default branch, so it starts once this branch is on `main`. It
  needs Actions enabled with write permission to repository contents. If
  `main` is protected, the bot's push will be refused.
- **The listing pipeline is still unscheduled.** Data refreshes only when
  someone runs `npm run pipeline`.
- **Guides are drafts.** Platform steps match the help pages as read on 27
  Oct 2026; interfaces change. The rest is editorial advice in the site's
  voice and should be reviewed for tone and accuracy.
- **Descriptions are still placeholders** because no `LLM_API_KEY` is set.
- REVIEW_PLACEHOLDER
