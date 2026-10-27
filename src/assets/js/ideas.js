// Idea feed filters: niche and difficulty, kept in the URL (?niche=&difficulty=)
// so event pages can link to a filtered feed. Without JavaScript every card
// is shown and the filters stay hidden.
const form = document.getElementById('idea-filters');
const niche = document.getElementById('f-idea-niche');
const difficulty = document.getElementById('f-idea-difficulty');
const count = document.getElementById('idea-count');
const none = document.getElementById('idea-none');
const cards = [...document.querySelectorAll('#idea-list .idea')];

function apply(push) {
  const n = niche.value;
  const d = difficulty.value;
  let shown = 0;
  for (const c of cards) {
    const ok = (!n || c.dataset.niches.split(' ').includes(n)) && (!d || c.dataset.difficulty === d);
    c.hidden = !ok;
    if (ok) shown += 1;
  }
  count.textContent = `${shown} ${shown === 1 ? 'idea' : 'ideas'}`;
  none.hidden = shown > 0;
  if (push) {
    const p = new URLSearchParams();
    if (n) p.set('niche', n);
    if (d) p.set('difficulty', d);
    const q = p.toString();
    history.replaceState(null, '', `${location.pathname}${q ? `?${q}` : ''}${location.hash}`);
  }
}

const params = new URLSearchParams(location.search);
const set = (sel, v) => { if (v && [...sel.options].some((o) => o.value === v)) sel.value = v; };
set(niche, params.get('niche'));
set(difficulty, params.get('difficulty'));
form.hidden = false;
niche.addEventListener('change', () => apply(true));
difficulty.addEventListener('change', () => apply(true));
document.getElementById('idea-reset').addEventListener('click', () => { niche.value = ''; difficulty.value = ''; apply(true); });
apply(false);

// Open the card named in the address (/ideas/#idea-...).
function openFromHash() {
  const el = location.hash.startsWith('#idea-') && document.getElementById(location.hash.slice(1));
  if (el) {
    if (el.hidden) { niche.value = ''; difficulty.value = ''; apply(true); }
    el.open = true;
    el.scrollIntoView({ block: 'start' });
  }
}
window.addEventListener('hashchange', openFromHash);
openFromHash();
