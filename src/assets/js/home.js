// Home page search and filters. The server renders every open event; once a
// filter changes we load the compact index and render matches with the same
// card function the build uses.
import { renderCard } from './card.js';
import { dateBound, deadlineInstant, relative } from './format.js';

const form = document.getElementById('filters');
const results = document.getElementById('results');
const countEl = document.getElementById('result-count');
const noResults = document.getElementById('no-results');
const chips = [...document.querySelectorAll('#niche-chips [data-niche]')];
const FIELDS = ['q', 'status', 'mode', 'niche', 'country', 'deadline', 'platform'];
let index = null;

// Filters are folded away on phones and open on wider screens.
const details = document.getElementById('filter-details');
if (matchMedia('(min-width: 601px)').matches) details.open = true;

function state() {
  const s = {};
  for (const f of FIELDS) s[f] = (form.elements[f]?.value || '').trim();
  return s;
}

function setState(s) {
  for (const f of FIELDS) if (form.elements[f]) form.elements[f].value = s[f] ?? (f === 'status' ? 'open' : '');
}

async function loadIndex() {
  if (!index) index = await (await fetch('/search-index.json')).json();
  return index;
}

const DAY = 86_400_000;

function matches(e, s, now) {
  if (s.status === 'open' && e.status === 'ended') return false;
  if (['upcoming', 'live', 'ended'].includes(s.status) && e.status !== s.status) return false;
  if (s.mode && e.mode !== s.mode) return false;
  if (s.niche && !e.niches.includes(s.niche)) return false;
  if (s.country && e.countryCode !== s.country) return false;
  if (s.platform && !e.platformKeys.includes(s.platform)) return false;
  const dl = deadlineInstant(e.deadline, e.tz);
  if (s.deadline === 'none' && e.deadline) return false;
  if (s.deadline === 'open' && !(dl && dl >= now)) return false;
  if (/^\d+$/.test(s.deadline) && !(dl && dl >= now && dl - now <= Number(s.deadline) * DAY)) return false;
  if (s.q) {
    const hay = [e.title, e.organiser, e.city, e.country, e.locationText, ...e.niches, ...e.platforms].join(' ').toLowerCase();
    for (const word of s.q.toLowerCase().split(/\s+/)) if (word && !hay.includes(word)) return false;
  }
  return true;
}

function sortEvents(list, s, now) {
  if (s.status === 'ended') return list.sort((a, b) => dateBound(b.end, { end: true, tz: b.tz }) - dateBound(a.end, { end: true, tz: a.tz }));
  const group = (e) => (e.status === 'ended' ? 3 : !e.deadline ? 1 : deadlineInstant(e.deadline, e.tz) < now ? 2 : 0);
  return list.sort((a, b) => {
    const ga = group(a);
    const gb = group(b);
    if (ga !== gb) return ga - gb;
    const ka = ga === 0 ? deadlineInstant(a.deadline, a.tz) : dateBound(a.start, { tz: a.tz });
    const kb = gb === 0 ? deadlineInstant(b.deadline, b.tz) : dateBound(b.start, { tz: b.tz });
    return ka - kb || a.title.localeCompare(b.title);
  });
}

function isDefault(s) {
  return s.status === 'open' && FIELDS.every((f) => f === 'status' || !s[f]);
}

function decorate(root) {
  const now = new Date();
  for (const t of root.querySelectorAll('time[data-rel]')) {
    if (t.nextElementSibling?.classList.contains('rel')) continue;
    const tz = t.dataset.tz || null;
    const d = deadlineInstant(t.getAttribute('datetime'), tz);
    if (!d || d < now) continue;
    const span = document.createElement('span');
    span.className = 'rel';
    span.textContent = ` (${relative(t.getAttribute('datetime'), now, tz)})`;
    t.after(span);
  }
}

async function update({ push = true } = {}) {
  const s = state();
  chips.forEach((c) => c.setAttribute('aria-pressed', String(c.dataset.niche === s.niche)));
  const params = new URLSearchParams();
  for (const f of FIELDS) if (s[f] && !(f === 'status' && s[f] === 'open')) params.set(f, s[f]);
  if (push) history.replaceState(null, '', params.toString() ? `?${params}` : location.pathname);
  const now = new Date();
  const list = sortEvents((await loadIndex()).filter((e) => matches(e, s, now)), s, now);
  results.innerHTML = list.slice(0, 600).map((e) => renderCard(e, now)).join('');
  decorate(results);
  countEl.textContent = `${list.length} hackathon${list.length === 1 ? '' : 's'}${list.length > 600 ? ' (first 600 shown)' : ''}`;
  noResults.hidden = list.length > 0;
}

let timer;
form.addEventListener('input', () => {
  clearTimeout(timer);
  timer = setTimeout(update, 120);
});
document.getElementById('reset').addEventListener('click', () => {
  setState({});
  update();
});
chips.forEach((c) => c.addEventListener('click', () => {
  form.elements.niche.value = form.elements.niche.value === c.dataset.niche ? '' : c.dataset.niche;
  update();
}));

decorate(document);
const initial = Object.fromEntries(new URLSearchParams(location.search));
if (Object.keys(initial).length) {
  setState({ status: 'open', ...initial });
  details.open = true;
  if (!isDefault(state())) update({ push: false });
}
