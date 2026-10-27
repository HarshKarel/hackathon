export const data = { permalink: '/robots.txt', eleventyExcludeFromCollections: true };
export function render({ site }) {
  return `User-agent: *\nAllow: /\n\nSitemap: ${site.url}/sitemap.xml\n`;
}
