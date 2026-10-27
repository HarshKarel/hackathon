// /llms.txt: a plain description of the site for language models.
export const data = { permalink: '/llms.txt', eleventyExcludeFromCollections: true };

export function render({ site }) {
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
- [Sitemap](${site.url}/sitemap.xml)

Event pages live at ${site.url}/hackathons/<slug>/ and include Event structured data (JSON-LD).

## Niches

${niches}

## Sources

${sources}

## Data

- ${site.counts.total} events on record: ${site.counts.upcoming} upcoming, ${site.counts.live} live, ${site.counts.ended} ended.
- Updated ${site.health.finishedAt ? site.health.finishedAt.slice(0, 10) : site.buildDate}.
`;
}
