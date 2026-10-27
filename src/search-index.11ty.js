// Compact list of every published event for the home page filters.
export const data = { permalink: '/search-index.json', eleventyExcludeFromCollections: true };
export function render({ site }) {
  return JSON.stringify(site.all.map((e) => e.compact));
}
