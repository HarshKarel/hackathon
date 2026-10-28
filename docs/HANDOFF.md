# Handoff: working on hackathon.so locally with Claude Code

Written 27 October 2026 at the end of Phase 3; updated 28 October 2026 after
the decision to move scheduled jobs to Vercel. `CLAUDE.md` in the project
root holds the rules and commands; Claude Code reads it automatically. This
file covers where things stand and what is open.

## 1. Get the right repo on your machine

The project lives at **https://github.com/HarshKarel/hackathon**.

If you downloaded a ZIP from GitHub, start again with a clone: a ZIP has no
git history and no link back to GitHub, so you cannot pull updates or push.

```bash
git clone https://github.com/HarshKarel/hackathon.git
cd hackathon
```

### Check you are in the right repo

Run these from the project folder:

```bash
git remote -v
# expect: origin  https://github.com/HarshKarel/hackathon.git (fetch) and (push)

git rev-parse --show-toplevel
# expect: the folder you are in (ends in /hackathon)

git branch --show-current
# expect: main

git fetch origin
git status
# expect: "Your branch is up to date with 'origin/main'" and nothing to commit

git log --oneline -3
# expect the newest commit to match the top of
# https://github.com/HarshKarel/hackathon/commits/main

grep '"name"' package.json
# expect: "name": "hackathon-so",

ls
# expect: CLAUDE.md  README.md  data  docs  eleventy.config.js  package.json  pipeline  scripts  src  tests
```

If `git remote -v` shows a different address, or prints nothing, you are not
in this repo. Clone it again as above.

### Set up and check it works

```bash
node -v              # 22 or newer (tests need 22)
npm install
npm test             # expect: # pass 98, # fail 0
npm run serve        # open http://localhost:8080
```

`npm fund` is not needed; it only lists packages asking for donations. There
is no `npm run dev`; the preview command is `npm run serve`.

### Start Claude Code in the right place

```bash
cd hackathon
claude
```

Start it from the project folder so it picks up `CLAUDE.md`. Inside Claude
Code, `/status` shows the working directory and `/memory` shows that
`CLAUDE.md` is loaded. A good first message:

> Read CLAUDE.md and docs/HANDOFF.md, run the checks in section 1, and tell
> me what state the project is in before changing anything.

## 2. Where things stand

| Phase | What it built | State |
| --- | --- | --- |
| 1 | Data pipeline (9 sources), permanent event store, rewrite engine, static site | On `main` |
| 2 | Unstop and Kaggle sources, weekly winners pipeline, 10 guides, suggested guides | On `main` |
| 3 | Idea feed (30 seed cards, idea starters), Gemini 3.8 Flash with the Batch API, backfill command, weekly idea generator, claim form, organiser fields | On `main` |

Numbers today: 869 events, 18 with winners, 269 marked "winners not published
yet", 30 idea cards. All 869 descriptions are still flagged placeholders,
because no AI key has been set anywhere yet.

Reports with the details: `docs/PHASE2_REPORT.md`, `docs/PHASE3_REPORT.md`.

## 3. Scheduled jobs today

| Job | Where it runs now | Notes |
| --- | --- | --- |
| Listing pipeline | Only by hand (`npm run pipeline`) | Should run twice a day once on Vercel. |
| Winners check | GitHub Actions, Mondays 04:23 UTC (`winners.yml`) | Needs no key. Stays until the Vercel job replaces it, then remove its schedule. |
| Idea generator | By hand only: Actions tab > "Ideas (manual)", or `npm run ideas` | Its schedule was removed on 28 October 2026. See below. |
| Backfill (once) | By hand only | `node --env-file=.env pipeline/backfill.mjs --dry-run`, then without `--dry-run`. |

**Why the ideas schedule was removed.** The first scheduled run, on
28 October 2026, failed only because `LLM_API_KEY` is not set in GitHub; all
98 tests passed in it. It was due at 05:41 UTC but started at 11:39 UTC,
almost 6 hours late. GitHub's scheduler gives no timing guarantee, which is
why scheduling moves to Vercel. A manual run now stops at once with a clear
message if the key or model is missing.

## 4. Decided: move hosting and schedules to Vercel (not built yet)

Researched on 27 October 2026 (Vercel, GitHub and database docs).

**The plan**
- **Hosting:** Vercel Pro (about $20 a month, which includes $20 of usage
  credit; the jobs use about $2 to $5 of it). Build command `npm run build`,
  output folder `_site`.
- **Schedules:** Vercel Cron starts each job within the scheduled minute.
  - Each cron starts a **Vercel Workflow** that runs the job as steps.
  - A step can run up to 800 s (30 min with a beta setting); the whole
    workflow has no time limit, retries failed steps up to 3 times, and can
    wait hours for a Gemini batch cheaply.
  - A plain cron run is stopped at its time limit and never retried, so a
    long job must not run as a single function.
  - Pro allows 100 cron jobs per project, as often as once a minute.

| Job | Proposed schedule | Workflow steps |
| --- | --- | --- |
| Listing pipeline | twice a day | fetch Devpost (about 10 min); fetch Unstop and Devfolio; fetch the rest; save; submit the Gemini batch; wait; apply results; save |
| Winners check | weekly | one step (about 11 min) |
| Idea generator | weekly | submit batch; wait; check and save |
| Backfill | once, from a protected URL | submit batch; wait; apply; save |

- **Data:** stays in git. The workflow's last step commits the JSON files in
  one commit through the GitHub API (needs a fine-grained token with Contents
  write on this repo only). The push triggers a Vercel redeploy, keeps the
  history of every change, and `git pull` keeps local work simple.
  - The raw listing-text cache (`.cache/source-text.json`) goes in a
    **private** Vercel Blob store: it must never be public.
  - Vercel Blob for everything is the simpler alternative, but loses history.
- **Database:** none needed now. Supabase's free tier pauses after a week of
  low activity. If logins or an organiser dashboard come later, use Supabase
  Pro ($25 a month) or Neon (Postgres on the Vercel Marketplace, official MCP
  server).
- **Site speed** is not affected by where the data lives: pages are built
  ahead of time and served from Vercel's network.

**Before building**
1. Ask Vercel Support whether the listing and winners fetches are acceptable.
   Vercel's fair-use page lists "scrapers" as never allowed, and these jobs
   fetch other sites' pages (politely, respecting robots.txt). If not, keep
   those two on GitHub Actions, started at the exact minute by a Vercel cron
   (`workflow_dispatch`), and move only the AI jobs.
2. Confirm that the Vercel Workflow SDK works in this plain Node and Eleventy
   project, since most of its docs use Next.js.

**What the user sets up**
- A Vercel Pro project connected to `HarshKarel/hackathon` (build
  `npm run build`, output `_site`).
- Environment variables in Vercel:
  - `LLM_API_KEY`: a Google AI Studio key from a project with billing on.
  - `LLM_MODEL`: `gemini-3.8-flash`.
  - `CLAIM_FORM_ENDPOINT`: a Formspree form URL.
  - `CRON_SECRET`: a random string of 16 or more characters.
  - A GitHub fine-grained token with Contents write on this repo.
- A private Blob store connected to the project.

**What gets built**
- A data layer: local files on a developer's machine; git commits plus Blob
  on Vercel.
- The workflows and `vercel.json` crons, with a lock (Vercel can start the
  same cron twice).
- A protected backfill URL.
- Tests and README steps.
- Removing the winners schedule from GitHub Actions once its Vercel job runs.

## 5. Other open items

1. **Backfill** the 869 placeholder descriptions: about $0.50 to $2.70 at
   batch prices. It can run locally now with the key in `.env` (see the table
   in section 3), or from Vercel once that is built.
2. **Claim form:** create a free Formspree form and set
   `CLAIM_FORM_ENDPOINT` where the site is built.
3. **Review the drafts.** The 10 guides are drafts: set `"draft": false` in
   `src/_data/guidesList.json` once each is reviewed. Also read the 30 seed
   idea cards (`data/ideas-seed.json`).

Not verified yet:
- Kaggle has never run against the real API.
- No real Gemini call has been made.
- No real claim email has been sent.
- The winners workflow has not run on GitHub yet; its first run is due on a
  Monday.

## 6. Working conventions

- Work on a branch and open a pull request, or ask before pushing to `main`.
- Run `npm test && npm run build && npm run check` before every commit.
- Keep each pipeline writing only its own files.
- New copy follows the standing rules in `CLAUDE.md`: plain English, no em
  dashes, facts exactly as the source states them.
