#!/usr/bin/env node
// Post-build checks on _site against the project's standing rules.
//   npm run build && npm run check
import fs from 'node:fs';
import path from 'node:path';
import { PATHS, ROOT } from '../pipeline/config.mjs';
import { sharedSentences } from '../pipeline/lib/copycheck.mjs';
import { statedFacts } from '../pipeline/lib/rewrite.mjs';

const SITE = path.join(ROOT, '_site');
const problems = [];
const fail = (m) => problems.push(m);

function walk(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((d) => (d.isDirectory() ? walk(path.join(dir, d.name)) : [path.join(dir, d.name)]));
}

if (!fs.existsSync(SITE)) {
  console.error('No _site folder. Run `npm run build` first.');
  process.exit(1);
}

const files = walk(SITE).filter((f) => /\.(html|txt|ics|json|xml|js|css)$/.test(f));

// Rule: no em dashes anywhere on the site.
for (const f of files) {
  if (fs.readFileSync(f, 'utf8').includes('\u2014')) fail(`em dash in ${path.relative(SITE, f)}`);
}

const store = JSON.parse(fs.readFileSync(PATHS.store, 'utf8'));
const published = store.events.filter((e) => e.published !== false);
const unpublished = store.events.filter((e) => e.published === false);
const sitemap = fs.readFileSync(path.join(SITE, 'sitemap.xml'), 'utf8');
let sourceText = {};
try { sourceText = JSON.parse(fs.readFileSync(PATHS.sourceText, 'utf8')); } catch { /* no cache */ }

let checkedCopy = 0;
for (const e of published) {
  const file = path.join(SITE, 'hackathons', e.slug, 'index.html');
  if (!fs.existsSync(file)) { fail(`missing page for ${e.slug}`); continue; }
  const html = fs.readFileSync(file, 'utf8');
  const inSitemap = sitemap.includes(`/hackathons/${e.slug}/<`);
  const noindex = html.includes('name="robots" content="noindex');
  if (e.indexable && (!inSitemap || noindex)) fail(`${e.slug}: indexable but missing from sitemap or marked noindex`);
  if (!e.indexable && (inSitemap || !noindex)) fail(`${e.slug}: below quality floor but in sitemap or not noindexed`);
  if (!html.includes(`href="${e.applyUrl.replace(/&/g, '&amp;')}"`)) fail(`${e.slug}: apply link missing`);
  const ld = html.match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g) || [];
  for (const block of ld) {
    try { JSON.parse(block.replace(/^<script[^>]*>|<\/script>$/g, '')); } catch { fail(`${e.slug}: JSON-LD does not parse`); }
  }
  if (!ld.some((b) => b.includes('"@type":"Event"'))) fail(`${e.slug}: no Event JSON-LD`);
  // Rule: never publish the source listing's own text.
  const src = sourceText[e.slug];
  if (src) {
    const body = (html.match(/<section class="description"[\s\S]*?<\/section>/) || [''])[0].replace(/<[^>]+>/g, ' ');
    const shared = sharedSentences(body, src, { allow: statedFacts(e) });
    if (shared.length) fail(`${e.slug}: description shares a sentence with the source: "${shared[0]}"`);
    checkedCopy += 1;
  }
}
for (const e of unpublished) {
  if (fs.existsSync(path.join(SITE, 'hackathons', e.slug, 'index.html'))) fail(`${e.slug}: unpublished (awaiting review) but a page was built`);
}

for (const must of ['index.html', 'archive/index.html', 'sources/index.html', 'subscribe/index.html', 'llms.txt', 'robots.txt', 'sitemap.xml', 'calendars/all.ics', 'search-index.json']) {
  if (!fs.existsSync(path.join(SITE, must))) fail(`missing ${must}`);
}

console.log(`checked ${files.length} files, ${published.length} event pages (${checkedCopy} against source text), ${unpublished.length} unpublished`);
if (problems.length) {
  console.error(`${problems.length} problem(s):\n- ${problems.slice(0, 50).join('\n- ')}`);
  process.exit(1);
}
console.log('all checks passed');
