// One event card. Used by the build (server-rendered grids) and by the
// browser (filtered results), so both always look the same.
import { esc, fmtDate, fmtRange, MODE_LABELS, STATUS_LABELS, deadlineInstant } from './format.js';

// c: compact event from the search index (see src/_data/site.js)
export function renderCard(c, now = new Date()) {
  const place = c.mode === 'online' ? 'Online' : [c.city, c.country].filter(Boolean).join(', ') || c.locationText || MODE_LABELS[c.mode];
  const dl = deadlineInstant(c.deadline, c.tz);
  let deadline;
  if (!c.deadline) {
    deadline = `<span class="dl-none">No deadline stated</span>`;
  } else {
    const passed = dl < now;
    const label = c.deadlineKind === 'submission' ? 'Submissions close' : 'Registration closes';
    deadline = `<span class="dl-label">${passed ? (c.deadlineKind === 'submission' ? 'Submissions closed' : 'Registration closed') : label}</span> <time datetime="${esc(c.deadline)}"${c.tz ? ` data-tz="${esc(c.tz)}"` : ''} data-rel>${esc(fmtDate(c.deadline, c.tz))}</time>`;
  }
  const niches = (c.niches || []).map((n) => `<li>${esc(n)}</li>`).join('');
  const via = (c.platforms || []).map((p) => esc(p)).join(', ');
  return `<article class="card" data-slug="${esc(c.slug)}">
<div class="card-top"><span class="badge badge-${esc(c.status)}">${STATUS_LABELS[c.status] || ''}</span><span class="card-mode">${esc(MODE_LABELS[c.mode] || '')}</span></div>
<h3 class="card-title"><a href="/hackathons/${esc(c.slug)}/">${esc(c.title)}</a></h3>
<p class="card-deadline">${deadline}</p>
<p class="card-meta">${esc(fmtRange(c.start, c.end, c.tz))} · ${esc(place)}</p>
${c.prize ? `<p class="card-prize">${esc(c.prize)}</p>` : ''}
<ul class="card-tags">${niches}</ul>
<p class="card-via">via ${via}</p>
</article>`;
}
