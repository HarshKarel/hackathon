// Guide metadata (titles, slugs, one-line descriptions, draft flags) lives in
// guidesList.json; the Markdown files under src/guides hold only the body.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));

export default function () {
  const list = JSON.parse(fs.readFileSync(path.join(here, 'guidesList.json'), 'utf8')).sort((a, b) => a.order - b.order);
  const byKey = Object.fromEntries(list.map((g) => [g.key, { ...g, url: `/guides/${g.slug}/` }]));
  const stages = ['Before', 'Applying', 'During', 'After'].map((name) => ({ name, guides: list.filter((g) => g.stage === name).map((g) => byKey[g.key]) }));
  return { list: list.map((g) => byKey[g.key]), byKey, stages, anyFinal: list.some((g) => !g.draft) };
}
