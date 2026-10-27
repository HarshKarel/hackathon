// /hackathons/<slug>/deadline.ics: one calendar entry at the stated deadline,
// with a reminder one day before.
import { calendar, deadlineVevent } from '../_lib/ics.js';

export const data = {
  pagination: { data: 'site.withDeadline', size: 1, alias: 'e', addAllPagesToCollections: false },
  permalink: (d) => `/hackathons/${d.e.slug}/deadline.ics`,
  eleventyExcludeFromCollections: true,
};

export function render({ e, site }) {
  return calendar({
    name: `Deadline: ${e.title}`,
    description: `Deadline for ${e.title}, from hackathon.so`,
    events: [deadlineVevent(e, site.url, site.now, { alarm: true })],
  });
}
