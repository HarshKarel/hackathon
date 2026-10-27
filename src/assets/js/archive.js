// Archive search: filters the server-rendered list in place.
const input = document.getElementById('archive-q');
const items = [...document.querySelectorAll('#archive-list li')];
const count = document.getElementById('archive-count');
const empty = document.getElementById('archive-empty');
input.addEventListener('input', () => {
  const words = input.value.toLowerCase().split(/\s+/).filter(Boolean);
  let shown = 0;
  for (const li of items) {
    const ok = words.every((w) => li.dataset.search.includes(w));
    li.hidden = !ok;
    if (ok) shown += 1;
  }
  count.textContent = `${shown} shown`;
  empty.hidden = shown > 0;
});
