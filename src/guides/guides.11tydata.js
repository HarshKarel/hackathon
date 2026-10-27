// Every Markdown file in this folder is a guide. Its front matter only sets
// `key`; title, description, URL and draft status come from guidesList.json.
const meta = (data) => {
  const g = data.guides?.byKey?.[data.key];
  if (!g) throw new Error(`guide ${data.page?.inputPath}: unknown key "${data.key}"`);
  return g;
};

export default {
  layout: 'guide.njk',
  eleventyComputed: {
    guide: (data) => meta(data),
    title: (data) => meta(data).title,
    description: (data) => meta(data).description,
    permalink: (data) => meta(data).url,
    ogType: () => 'article',
  },
};
