// Series detection. A source-stated series (ETHGlobal, seeds, Devfolio
// brands) always wins. Otherwise events form a series when their titles are
// the same apart from a year or edition marker ("Next Byte Hacks V4" and
// "Next Byte Hacks V5"), and no two of them state different organisers.
// Two events with identical titles only form a series when every one of them
// states the same organiser. Generic names ("Hack", "Hackathon") never do.
import { editionlessTitle, normOrganiser, normTitle, seriesNameFrom } from './text.mjs';

const GENERIC = new Set([
  'hack', 'hacks', 'hackathon', 'hackathons', 'hack day', 'hackday', 'codefest', 'code fest', 'datathon', 'game jam',
  'jam', 'ideathon', 'buildathon', 'build a thon', 'challenge', 'innovation challenge', 'ai hackathon', 'hack night',
]);

export function deriveSeries(events) {
  const groups = new Map();
  for (const e of events) {
    if (e.series && !e.seriesDerived) continue;
    const key = editionlessTitle(e.title);
    if (key.length < 5 || GENERIC.has(key)) {
      if (e.seriesDerived) { e.series = null; delete e.seriesDerived; }
      continue;
    }
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(e);
  }
  const found = [];
  for (const [key, es] of groups) {
    const orgs = new Set(es.map((e) => normOrganiser(e.organiser)).filter(Boolean));
    const titles = new Set(es.map((e) => normTitle(e.title)));
    const allStateSameOrganiser = orgs.size === 1 && es.every((e) => normOrganiser(e.organiser));
    const ok = es.length >= 2 && orgs.size <= 1 && (titles.size >= 2 || allStateSameOrganiser);
    if (!ok) {
      for (const e of es) if (e.seriesDerived) { e.series = null; delete e.seriesDerived; }
      continue;
    }
    const earliest = [...es].sort((a, b) => a.startDate.localeCompare(b.startDate))[0];
    const name = seriesNameFrom(earliest.title) || earliest.title;
    for (const e of es) {
      e.series = name;
      e.seriesDerived = true;
    }
    found.push({ key, name, editions: es.map((e) => e.slug) });
  }
  return found;
}
