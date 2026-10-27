// Subscribable feeds at stable URLs: /calendars/all.ics and one per niche
// (/calendars/<niche-slug>.ics). Each event adds its dates and, when stated,
// its deadline.
import { calendar, eventVevents } from '../_lib/ics.js';

export const data = {
  pagination: { data: 'site.feeds', size: 1, alias: 'feed', addAllPagesToCollections: false },
  permalink: (d) => `/calendars/${d.feed.slug}.ics`,
  eleventyExcludeFromCollections: true,
};

export function render({ feed, site }) {
  const events = site.feedEvents.filter((e) => !feed.niche || e.niches.includes(feed.niche));
  return calendar({
    name: `${feed.name} (hackathon.so)`,
    description: `${feed.name} worldwide, with deadlines. Updated daily from public sources by hackathon.so.`,
    events: events.flatMap((e) => eventVevents(e, site.url, site.now)),
  });
}
