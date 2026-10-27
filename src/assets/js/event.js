// Event page: show the deadline in the visitor's own time zone, plus a
// countdown. Runs in the browser, so it uses the visitor's settings.
import { deadlineInstant, isDateOnly, relative } from './format.js';

const el = document.getElementById('deadline-local');
if (el) {
  const v = el.dataset.deadline;
  const tz = el.dataset.tz || null;
  const now = new Date();
  const zone = Intl.DateTimeFormat().resolvedOptions().timeZone || 'your time zone';
  if (isDateOnly(v)) {
    const d = deadlineInstant(v, tz);
    el.textContent = `The source gives a date only, no time${tz ? '' : ', so it counts until the day ends everywhere'}. ${d >= now ? `About ${relative(v, now, tz).replace(/^in /, '')} left.` : 'This date has passed.'}`;
  } else {
    const d = new Date(v);
    const local = new Intl.DateTimeFormat(undefined, {
      weekday: 'short', day: 'numeric', month: 'short', year: 'numeric',
      hour: '2-digit', minute: '2-digit', timeZoneName: 'short',
    }).format(d);
    el.textContent = `In your time (${zone}): ${local}. ${d >= now ? `Closes ${relative(v, now)}.` : 'This deadline has passed.'}`;
  }
}
