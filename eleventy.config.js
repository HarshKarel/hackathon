// Eleventy builds the static site from the pipeline's data. Chosen because it
// outputs plain HTML with no client framework, and data pagination gives each
// event its own permanent URL with no extra code.
import { renderCard } from './src/assets/js/card.js';
import { esc, fmtDate, fmtDateLong, fmtDateTime, fmtRange, MODE_LABELS, STATUS_LABELS, DEADLINE_LABELS, relative } from './src/assets/js/format.js';

export default function (eleventyConfig) {
  eleventyConfig.addPassthroughCopy({ 'src/assets': 'assets' });

  eleventyConfig.addShortcode('card', (e) => renderCard(e.compact || e));
  eleventyConfig.addFilter('date', (v, tz) => fmtDate(v, tz));
  eleventyConfig.addFilter('dateLong', (v, tz) => fmtDateLong(v, tz));
  eleventyConfig.addFilter('dateTime', (v, tz) => fmtDateTime(v, tz));
  eleventyConfig.addFilter('range', (a, b, tz) => fmtRange(a, b, tz));
  eleventyConfig.addFilter('relative', (v) => relative(v));
  eleventyConfig.addFilter('statusLabel', (s) => STATUS_LABELS[s] || s);
  eleventyConfig.addFilter('modeLabel', (s) => MODE_LABELS[s] || s);
  eleventyConfig.addFilter('deadlineLabel', (s) => DEADLINE_LABELS[s] || 'Deadline');
  eleventyConfig.addFilter('json', (v) => JSON.stringify(v).replace(/</g, '\\u003c'));
  eleventyConfig.addFilter('esc', (v) => esc(v));
  eleventyConfig.addFilter('take', (arr, n) => (arr || []).slice(0, n));
  eleventyConfig.addFilter('paras', (s) => String(s || '').split(/\n\s*\n/).map((p) => p.trim()).filter(Boolean));
  eleventyConfig.addFilter('place', (e) => (e.mode === 'online' ? 'Online' : [e.city, e.country].filter(Boolean).join(', ') || e.locationText || MODE_LABELS[e.mode]));
  eleventyConfig.addFilter('absUrl', (path, base) => new URL(path, base).toString());
  eleventyConfig.addFilter('metaDescription', (s) => {
    const t = String(s || '').replace(/\s+/g, ' ').trim();
    return t.length <= 158 ? t : `${t.slice(0, 155).replace(/\s+\S*$/, '')}...`;
  });

  return {
    dir: { input: 'src', output: '_site', includes: '_includes', data: '_data' },
    templateFormats: ['njk', '11ty.js', 'md'],
    htmlTemplateEngine: 'njk',
    // Guides are plain Markdown; nothing in them is a template.
    markdownTemplateEngine: false,
  };
}
