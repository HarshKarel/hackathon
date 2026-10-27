# Handoff: working on hackathon.so locally with Claude Code

Written 27 October 2026, at the end of Phase 3. `CLAUDE.md` in the project
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

## 3. Open items (in a sensible order)

1. **AI key.** Create a Google AI Studio key in a project with billing on
   (the Batch API is not on the free tier).
   - Locally: put `LLM_API_KEY` and `LLM_MODEL=gemini-3.8-flash` in `.env`
     (it is gitignored), then run
     `node --env-file=.env pipeline/backfill.mjs --dry-run`, then without
     `--dry-run`.
   - The backfill rewrites the 869 placeholders in one batch job, estimated at
     $0.50 to $2.70 at batch prices.
   - Then run `npm run build && npm run check`, commit `data/` and push.
2. **GitHub settings** (Settings, Secrets and variables, Actions): secret
   `LLM_API_KEY`, variable `LLM_MODEL` = `gemini-3.8-flash`. Also set Actions
   workflow permissions to "Read and write". The ideas workflow runs every
   Wednesday and fails until these exist.
3. **Claim form.** Create a free Formspree form, then set
   `CLAIM_FORM_ENDPOINT=https://formspree.io/f/<id>` wherever the site is
   built.
4. **Review the drafts.** The 10 guides are drafts: set `"draft": false` in
   `src/_data/guidesList.json` once each is reviewed. Also read through the 30
   seed idea cards (`data/ideas-seed.json`).
5. **Hosting and schedules** (decision pending, see section 4).
6. **Listing pipeline schedule.** It still runs only by hand
   (`npm run pipeline`). It should run twice a day.

Not verified yet:
- Kaggle has never run against the real API.
- No real Gemini call has been made.
- No real claim email has been sent.
- The GitHub workflows have not run.

## 4. Pending decision: Vercel

Researched on 27 October 2026 (Vercel, GitHub and database docs). The
recommended setup:

- **Hosting:** Vercel Pro (about $20 a month, which includes $20 of usage
  credit). Build command `npm run build`, output folder `_site`.
- **Schedules:** Vercel Cron runs within the scheduled minute; GitHub
  Actions schedules can be delayed or dropped at busy times.
  - One cron per job starts a **Vercel Workflow** that runs the job as steps.
    A step can run up to 800 s (30 min in beta); the whole workflow has no
    time limit and can wait hours for a Gemini batch cheaply.
  - The listing pipeline would be split into steps by source (Devpost alone
    is about 10 min).
  - A plain cron run is stopped at its time limit and is never retried, so
    one long job must not run as a single function.
- **Data:** keep it in git. The workflow's last step commits the JSON files
  through the GitHub API, which triggers a Vercel redeploy, keeps history, and
  keeps local work simple.
  - The raw listing-text cache goes in a private Vercel Blob store (it must
    never be public).
  - Vercel Blob for everything is the simpler alternative, but loses history.
- **Database:** none needed now. Supabase's free tier pauses after a week of
  low activity. If logins or an organiser dashboard come later, use Supabase
  Pro ($25 a month) or Neon (Postgres on the Vercel Marketplace, with an
  official MCP server).
- **Check first:** Vercel's fair-use page lists "scrapers" as never allowed.
  Ask Vercel Support whether the polite listing and winners fetches are
  acceptable before moving them. If not, keep those two on GitHub Actions,
  started at the exact minute by a Vercel cron.
- **Still to confirm:** that the Vercel Workflow SDK works in this plain
  Node and Eleventy project, since most of its docs use Next.js.

Nothing for this has been built yet.

## 5. Working conventions

- Work on a branch and open a pull request, or ask before pushing to `main`.
- Run `npm test && npm run build && npm run check` before every commit.
- Keep each pipeline writing only its own files.
- New copy follows the standing rules in `CLAUDE.md`: plain English, no em
  dashes, facts exactly as the source states them.
