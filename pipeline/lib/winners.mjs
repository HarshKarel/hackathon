// Winners: parsers for the two platforms that publish them in a form we can
// read, plus the logic that decides which events to check.
//
// Winners data is copied exactly as the platform states it: place (the prize
// name), project name, project URL, and team or author. Only HTML entities
// are decoded and surrounding whitespace trimmed; nothing is reworded.
import { safeUrl } from './record.mjs';
import { computeStatus } from './status.mjs';
import { toInstant } from './dates.mjs';
import { decodeEntities, stripTags } from './text.mjs';

const text = (html) => decodeEntities(stripTags(html)).replace(/\s+/g, ' ').trim();

// ---------- Devpost ----------
// The project gallery lists winners first, each with a "Winner" badge; it
// pages with ?page=N. The place (prize name) is on each project's own page,
// under "Submitted to" for this hackathon.

export function parseDevpostGallery(html) {
  const items = [];
  for (const m of html.matchAll(/<div class="[^"]*gallery-item"[^>]*>([\s\S]*?)<\/footer>/g)) {
    const block = m[1];
    const href = block.match(/<a [^>]*class="[^"]*link-to-software[^"]*"[^>]*href="([^"]+)"/) || block.match(/href="(https:\/\/devpost\.com\/software\/[^"]+)"/);
    const name = block.match(/<h5>\s*([\s\S]*?)\s*<\/h5>/);
    items.push({
      project: name ? text(name[1]) : null,
      projectUrl: href ? safeUrl(decodeEntities(href[1])) : null,
      winner: /class="winner"/.test(block),
    });
  }
  const pages = [...html.matchAll(/project-gallery\?page=(\d+)/g)].map((x) => Number(x[1]));
  return { items, lastPage: pages.length ? Math.max(...pages) : 1 };
}

// Places this project won at the given hackathon, plus its team as listed.
export function parseDevpostProject(html, hackathonHost) {
  const places = [];
  const from = html.indexOf('id="submissions"');
  const to = from >= 0 ? html.indexOf('</aside>', from) : -1;
  const block = from >= 0 ? html.slice(from, to > from ? to : from + 30000) : '';
  // One entry per hackathon the project was submitted to.
  for (const m of block.matchAll(/<div class="software-list-content">([\s\S]*?)<\/div>/g)) {
    const link = m[1].match(/<a href="([^"]+)"/);
    if (!link) continue;
    let host = '';
    try { host = new URL(decodeEntities(link[1])).host; } catch { /* ignore */ }
    if (hackathonHost && host !== hackathonHost) continue;
    for (const w of m[1].matchAll(/<span class="winner[^"]*">\s*Winner\s*<\/span>([\s\S]*?)<\/li>/g)) {
      const place = text(w[1]);
      if (place) places.push(place);
    }
  }
  const team = [];
  const teamBlock = html.match(/<section id="app-team">([\s\S]*?)<\/section>/);
  if (teamBlock) {
    for (const li of teamBlock[1].matchAll(/<li class="software-team-member"[\s\S]*?<\/li>/g)) {
      const named = [...li[0].matchAll(/<a class="user-profile-link"[^>]*>([^<]+)<\/a>/g)].map((x) => text(x[1])).filter(Boolean);
      const alt = li[0].match(/<img alt="([^"]*)"/);
      const name = named[0] || (alt ? text(alt[1]) : '');
      if (name) team.push(name);
    }
  }
  return { places, team };
}

export async function devpostWinners(http, hackathonUrl, { maxPages = 5 } = {}) {
  const base = new URL(hackathonUrl);
  const gallery = `${base.origin}/project-gallery`;
  const winners = [];
  let sawNonWinner = false;
  for (let page = 1; page <= maxPages && !sawNonWinner; page++) {
    const html = await http.getText(page === 1 ? gallery : `${gallery}?page=${page}`);
    // A real gallery (even an empty one) has this element. Anything else
    // (changed markup, an interstitial) must not be read as "no winners".
    if (!/id="submission-gallery"/.test(html)) throw new Error(`unrecognised project gallery page at ${gallery}`);
    const { items, lastPage } = parseDevpostGallery(html);
    for (const it of items) {
      if (!it.winner) { sawNonWinner = true; break; }
      winners.push(it);
    }
    if (page >= lastPage || !items.length) break;
  }
  const out = [];
  for (const w of winners) {
    let places = [];
    let team = [];
    // A failed project page fails the whole check (retried next week), so
    // winners are never stored with a missing place or team.
    if (w.projectUrl) ({ places, team } = parseDevpostProject(await http.getText(w.projectUrl), base.host));
    // A project can win several prizes: one row per place, as stated. With
    // no prize name on the project page, the gallery badge ("Winner") is the
    // stated place.
    for (const place of places.length ? places : ['Winner']) {
      out.push({ place, project: w.project, projectUrl: w.projectUrl, team: team.length ? team.join(', ') : null });
    }
  }
  return { winners: out, checkedUrl: gallery };
}

// ---------- Devfolio ----------
// /api/hackathons/<uuid>/prizes lists each prize with its winning projects
// (empty until winners are announced). Each project's public URL needs its
// slug from /api/projects/<uuid>.

export async function devfolioWinners(http, hackathonId) {
  const api = 'https://api.devfolio.co/api';
  const prizes = await http.getJson(`${api}/hackathons/${encodeURIComponent(hackathonId)}/prizes`);
  if (!Array.isArray(prizes)) throw new Error(`unexpected Devfolio prizes response for ${hackathonId}`);
  const out = [];
  for (const p of prizes) {
    for (const pr of p.projects || []) {
      // A failed project lookup fails the whole check (retried next week).
      const d = await http.getJson(`${api}/projects/${encodeURIComponent(pr.uuid)}`);
      const projectUrl = d?.project?.slug ? safeUrl(`https://devfolio.co/projects/${d.project.slug}`) : null;
      // Team as stated: the team name, or the members' names when the team
      // has none.
      const members = (d?.members || []).map((m) => [m.first_name, m.last_name].filter(Boolean).join(' ').trim()).filter(Boolean);
      out.push({
        place: String(p.name || '').trim() || 'Winner',
        project: String(pr.name || '').trim() || null,
        projectUrl,
        team: pr.team?.name ? String(pr.team.name).trim() : members.length ? members.join(', ') : null,
      });
    }
  }
  return { winners: out, checkedUrl: `${api}/hackathons/${hackathonId}/prizes` };
}

// ---------- which events to check ----------

// Ended within the window, winners still empty, and listed on a platform we
// can read winners from.
export function winnersCandidates(events, winnersByslug, { now, windowDays }) {
  const cutoff = new Date(now.getTime() - windowDays * 86_400_000);
  return events.filter((e) => {
    if (e.published === false) return false;
    if (computeStatus(e, now) !== 'ended') return false;
    const end = toInstant(e.endDate, { endOfDay: true, tz: e.timezone });
    if (!end || end < cutoff) return false;
    if (winnersByslug[e.slug]?.winners?.length) return false;
    return e.sources.some((s) => s.platform === 'devpost' || s.platform === 'devfolio');
  });
}
