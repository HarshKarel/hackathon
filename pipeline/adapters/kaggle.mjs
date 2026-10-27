// Kaggle: active competitions from the official Kaggle API
// (GET https://www.kaggle.com/api/v1/competitions/list, HTTP Basic auth with
// the account's API username and key). Every listing is typed "competition".
// The adapter runs only when KAGGLE_USERNAME and KAGGLE_KEY are set; without
// them it is skipped with one line in the health log and no error.
const API = 'https://www.kaggle.com/api/v1/competitions/list';
const MAX_PAGES = 10;

export function kaggleCredentials(env = process.env) {
  if (!env.KAGGLE_USERNAME || !env.KAGGLE_KEY) return null;
  return { username: env.KAGGLE_USERNAME, key: env.KAGGLE_KEY };
}

// The API has returned "ref" both as a slug ("titanic") and as a full URL
// ("https://www.kaggle.com/c/titanic") over the years; accept either.
export function slugFromRef(ref) {
  const s = String(ref || '').trim();
  if (!s) return null;
  if (/^https?:\/\//.test(s)) return new URL(s).pathname.split('/').filter(Boolean).pop() || null;
  return s.replace(/^\/+|\/+$/g, '').split('/').pop();
}

export function toListing(c) {
  const slug = slugFromRef(c.ref) || slugFromRef(c.url);
  const url = slug ? `https://www.kaggle.com/competitions/${slug}` : c.url;
  const maxTeam = Number(c.maxTeamSize);
  return {
    platform: 'kaggle',
    sourceId: c.id ?? slug,
    url,
    applyUrl: url,
    type: 'competition',
    title: c.title,
    organiser: c.organizationName || null,
    startDate: c.enabledDate,
    endDate: c.deadline,
    // Kaggle's entry deadline is the last day to join; without one, the final
    // submission deadline is the stated cut-off.
    registrationDeadline: c.newEntrantDeadline || c.deadline || null,
    deadlineKind: c.newEntrantDeadline ? 'registration' : 'submission',
    mode: 'online',
    prizeText: c.reward ? String(c.reward) : null,
    teamSizeText: maxTeam > 0 ? (maxTeam === 1 ? '1 member (individual)' : `Up to ${maxTeam} per team`) : null,
    themes: [c.category, ...(c.tags || []).map((t) => (typeof t === 'string' ? t : t.name))].filter(Boolean),
    platformNiches: ['Data Science'],
    sourceText: c.description || '',
  };
}

export default {
  platform: 'kaggle',
  async fetch({ http, env = process.env, log }) {
    const creds = kaggleCredentials(env);
    if (!creds) return { skipped: true, reason: 'KAGGLE_USERNAME and KAGGLE_KEY are not set', listings: [], errors: [], fetched: 0 };
    const headers = { authorization: `Basic ${Buffer.from(`${creds.username}:${creds.key}`).toString('base64')}` };
    const all = [];
    for (let page = 1; page <= MAX_PAGES; page++) {
      const batch = await http.getJson(`${API}?page=${page}`, { headers, noCache: true });
      if (!Array.isArray(batch) || !batch.length) break;
      all.push(...batch);
    }
    const listings = [];
    const errors = [];
    for (const c of all) {
      // "Getting Started" competitions are permanent tutorials (e.g. Titanic)
      // with far-off deadlines, not time-bound competitions.
      if (/getting started/i.test(String(c.category || ''))) continue;
      try {
        listings.push(toListing(c));
      } catch (err) {
        errors.push(`kaggle:${c.ref || c.id}: ${err.message}`);
      }
    }
    log(`kaggle: ${all.length} active competitions`);
    return { listings, errors, fetched: all.length };
  },
};
