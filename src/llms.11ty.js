// /llms.txt: a plain description of the site for language models.
export const data = { permalink: '/llms.txt', eleventyExcludeFromCollections: true };

export function render({ site, guides }) {
  const niches = site.niches.map((n) => `- [${n.name}](${site.url}/niche/${n.slug}/): ${n.openCount} open`).join('\n');
  const sources = site.sources.map((s) => `- ${s.name}: ${s.covers}`).join('\n');
  return `# hackathon.so

> A worldwide hackathon directory. Every hackathon gets one permanent page with its dates, deadline, prizes and eligibility as stated by the source, and a link to apply on the platform that lists it. Pages stay published after an event ends.

Facts (dates, deadlines, prizes, eligibility, links) are copied exactly from public sources. Descriptions are original text written for this site; they never reuse the source's wording. hackathon.so does not take registrations.

Event status is computed from dates: upcoming, then live, then ended. Deadlines are shown with their time zone where the source gives one. Some descriptions are flagged placeholders built from the facts while an original write-up is pending.

## Key pages

- [Open hackathons](${site.url}/): upcoming and live events sorted by deadline, with search and filters
- [Archive](${site.url}/archive/): every ended event
- [Browse by niche](${site.url}/niche/)
- [Browse by country](${site.url}/country/)
- [Browse by month](${site.url}/month/)
- [Series](${site.url}/series/): roll-ups of recurring events
- [Sources](${site.url}/sources/): platforms we read and when each was last fetched
- [Calendar feeds](${site.url}/subscribe/): ICS feeds for all events and per niche
- [Guides](${site.url}/guides/): practical guides for each stage of a hackathon${guides.anyFinal ? '' : ' (drafts under editorial review)'}
- [Project ideas](${site.url}/ideas/): ${site.counts.ideas} project ideas sized for a 24 to 48 hour hackathon, filterable by niche and difficulty
- [Sitemap](${site.url}/sitemap.xml)

Event pages live at ${site.url}/hackathons/<slug>/ and include Event structured data (JSON-LD). Some listings are competitions (for example Kaggle) rather than hackathons and are labelled as such.

After an event ends, its page shows the winners when they are published on Devpost or Devfolio, copied exactly as the platform states them (place, project, project link, team). If nothing is published yet, the page says so and shows the date the event ended. Winners are checked weekly for 60 days after an event ends.

Event pages also show up to three "idea starters": project idea cards that share a niche with the event. Ended events keep the ideas they showed.

## Project ideas

Each idea card has a title, a one-line pitch, what it does (who it is for, the core feature and the demo moment), 1 to 3 niches, a suggested stack, a difficulty (weekend-easy, weekend-medium, weekend-hard) and a team size fit (solo friendly, pair, team). Seed ideas are written by the hackathon.so team; generated ideas are added weekly by an AI pipeline, checked in code, and labelled with the date they were generated.

${site.ideas.map((i) => `- [${i.title}](${site.url}/ideas/#idea-${i.id}): ${i.pitch} (${i.niches.join(', ')}; ${i.difficultyLabel}; ${i.teamSizeLabel})`).join('\n')}

## Guides

${guides.list.map((g) => `- [${g.title}](${site.url}${g.url}): ${g.description}`).join('\n')}

## Niches

${niches}

## Sources

${sources}

## Data

- ${site.counts.total} events on record: ${site.counts.upcoming} upcoming, ${site.counts.live} live, ${site.counts.ended} ended.
- Winners published for ${site.counts.withWinners} ended events; ${site.counts.winnersNotPublished} checked with nothing published yet.
- ${site.counts.ideas} project ideas (${site.counts.seedIdeas} seed, ${site.counts.generatedIdeas} generated).
- Updated ${site.health.finishedAt ? site.health.finishedAt.slice(0, 10) : site.buildDate}.
`;
}
