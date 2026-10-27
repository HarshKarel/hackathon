// Sitemap: browse pages, the guides and ideas sections, and every published
// event page at or above the quality floor. Pages below the floor are built
// with noindex and left out.
export const data = { permalink: '/sitemap.xml', eleventyExcludeFromCollections: true };

const xmlEsc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;');

export function render({ site, guides }) {
  const urls = [
    { loc: '/', changefreq: 'daily' },
    { loc: '/archive/', changefreq: 'daily' },
    { loc: '/niche/' }, { loc: '/country/' }, { loc: '/month/' }, { loc: '/series/' },
    { loc: '/sources/' }, { loc: '/subscribe/' },
    ...site.niches.filter((n) => n.total).map((n) => ({ loc: `/niche/${n.slug}/` })),
    ...site.countries.map((c) => ({ loc: `/country/${c.slug}/` })),
    ...site.months.map((m) => ({ loc: `/month/${m.slug}/` })),
    ...site.series.map((s) => ({ loc: `/series/${s.slug}/` })),
    // Guides and ideas sections. Draft guides are listed too; their pages
    // show a draft notice until approved.
    { loc: '/guides/' },
    ...guides.list.map((g) => ({ loc: g.url })),
    { loc: '/ideas/', changefreq: 'weekly' },
    ...site.all.filter((e) => e.indexable).map((e) => ({ loc: `/hackathons/${e.slug}/`, lastmod: e.lastCheckedAt.slice(0, 10) })),
  ];
  const body = urls.map((u) => `  <url><loc>${xmlEsc(site.url + u.loc)}</loc>${u.lastmod ? `<lastmod>${u.lastmod}</lastmod>` : ''}${u.changefreq ? `<changefreq>${u.changefreq}</changefreq>` : ''}</url>`).join('\n');
  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${body}\n</urlset>\n`;
}
