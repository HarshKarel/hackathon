// /hackathons/<slug>/event.ics: the event's dates (and deadline, if stated).
import { calendar, eventVevents } from '../_lib/ics.js';

export const data = {
  pagination: { data: 'site.all', size: 1, alias: 'e', addAllPagesToCollections: false },
  permalink: (d) => `/hackathons/${d.e.slug}/event.ics`,
  eleventyExcludeFromCollections: true,
};

export function render({ e, site }) {
  return calendar({
    name: e.title,
    description: `${e.title} on hackathon.so`,
    events: eventVevents(e, site.url, site.now, { alarm: true }),
  });
}
