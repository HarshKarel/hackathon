# hackathon.so: notes for Claude Code

A worldwide hackathon directory. One permanent page per event (upcoming, then
live, then ended; pages never disappear), a winners section, guides, a
project idea feed, and a "Claim this listing" form. Static site built with
Eleventy from JSON files in `data/`, which scheduled pipelines keep up to date.

Read `docs/HANDOFF.md` for where things stand and what is open.

## Standing rules (apply to every change)

1. **Rewrite, never copy.** Event descriptions are original text. Never
   publish a source listing's own wording. The copy check
   (`pipeline/lib/copycheck.mjs`) and `npm run check` enforce it.
2. **No em dashes** (the U+2014 character) in any copy we write: descriptions,
   UI text, guides, idea cards, docs. Use commas, full stops or parentheses.
   The only exemption is the winners table, which copies names verbatim.
3. **Facts come from source data exactly.** Dates, deadlines, prizes,
   eligibility and links are never reworded or invented. Winners are copied
   exactly as the platform states them.
4. **List facts only and link out to apply.** Respect robots.txt (the HTTP
   client checks it) and keep requests polite (1 per second per site).
5. **Worldwide scope.** Country is a filter, never the frame.
6. **Secrets:** the AI key comes only from `LLM_API_KEY` and the model only
   from `LLM_MODEL`. Never hardcode or log either; use `redact()` from
   `pipeline/lib/gemini.mjs` on anything printed.
7. **Do not deploy** unless the user asks. Do not push to `main` unless the
   user asks.

## Commands

```bash
npm install
npm run serve        # local preview at http://localhost:8080 (there is no "dev" script)
npm test             # unit tests (node:test, Node 22)
npm run build        # build into _site/
npm run check        # site rules: em dashes, copy check, sitemap, links, ideas, claim link
npm run pipeline     # live fetch of every source (about 11 min); --use-cache, --only=devpost, --no-ai
npm run winners      # weekly winners check (about 10 min)
npm run ideas        # weekly idea generator (needs the AI key)
npm run backfill     # one-time rewrite of placeholder descriptions (needs the AI key); --dry-run first
npm run test:claim   # browser test of the claim form (build with CLAIM_FORM_ENDPOINT set first)
```

Before every commit: `npm test && npm run build && npm run check`.

The project does not load `.env` by itself. Use `node --env-file=.env pipeline/backfill.mjs`
(or export the variables in the shell) when a command needs the AI key.

## Layout

```
pipeline/
  adapters/          one module per source (devpost, devfolio, unstop, mlh, hackerearth, ethglobal, hackclub, kaggle, seed)
  lib/http.mjs       polite fetch: bot user agent, robots.txt, per-site rate limit, disk cache (.cache/http)
  lib/record.mjs     normalise a listing into the record format (docs/RECORD_FORMAT.md)
  lib/dedupe.mjs     two-pass dedupe; lib/store.mjs permanent store, stable slugs, redirects
  lib/rewrite.mjs    facts hash, rewrite requests, validators, review flag, placeholders
  lib/gemini.mjs     Gemini REST client (generateContent, Batch API)
  lib/aiflow.mjs     shared batch flow: 10+ items -> one Batch API job, fewer -> standard requests
  lib/ideas.mjs      idea card format, validateIdea, near-duplicate check
  lib/winners.mjs    Devpost and Devfolio winners parsers
  run.mjs            listing pipeline; winners.mjs, ideas.mjs, backfill.mjs are separate entry points
src/                 Eleventy site: _data/site.js builds everything templates need
  _lib/ideas.js      idea starters on event pages; _lib/suggest.js suggested guides
  guides/*.md        10 guides (all drafts; metadata in _data/guidesList.json)
data/
  events.json        the event store (written by the listing pipeline and backfill)
  winners.json       written only by the winners pipeline
  ideas-seed.json    30 hand-written idea cards (edited by hand only)
  ideas-generated.json, ideas-rejected.jsonl   written only by the idea generator
  health/            run logs; ai-runs.jsonl logs every AI run (job ids, counts, cost)
.github/workflows/   winners.yml (Mondays 04:23 UTC), ideas.yml (Wednesdays 05:41 UTC)
tests/               node:test files; fake-gemini.mjs stands in for the Gemini API
```

## Things that are easy to get wrong

- Each pipeline writes only its own files, so they never conflict. Keep it
  that way (both workflows share the `data-store` concurrency group).
- `.cache/` is gitignored on purpose: `.cache/source-text.json` holds the
  sources' own listing text, used only for the copy check. Never commit it or
  show it on the site.
- Event `featured` and `claimedBy` are set by hand, never by a source update.
- Ended events keep their idea starters: generated cards only reach an ended
  event if `source.generatedAt` is before the event ended.
- Gemini 3.8 Flash: thinking cannot be switched off (`LOW` is the minimum);
  `temperature` is ignored; requests send `store: false`.
- Playwright is not a project dependency. Scripts load the machine's copy
  through `createRequire`.
- Tests need Node 22 (`node --test` with a glob).
