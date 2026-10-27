// Claim form: fills in the listing from ?event=<slug>&title=<title> and sends
// the form to the form service (Formspree) without leaving the page. Without
// JavaScript the form still posts normally.
const params = new URLSearchParams(location.search);
const slug = params.get('event') || '';
const title = (params.get('title') || '').slice(0, 200);
const form = document.getElementById('claim-form');

if (/^[a-z0-9-]{1,120}$/.test(slug)) {
  const url = `${location.origin}/hackathons/${slug}/`;
  const listing = document.getElementById('claim-listing');
  if (listing && !listing.value) listing.value = url;
  const label = document.getElementById('claim-event');
  label.textContent = `Listing: ${title || slug}`;
  label.hidden = false;
  const subject = document.getElementById('claim-subject');
  if (subject) subject.value = `hackathon.so listing claim: ${title || slug}`;
}

if (form) {
  const done = document.getElementById('claim-done');
  const error = document.getElementById('claim-error');
  const button = document.getElementById('claim-submit');
  form.addEventListener('submit', async (ev) => {
    ev.preventDefault();
    error.hidden = true;
    button.disabled = true;
    button.textContent = 'Sending...';
    try {
      const res = await fetch(form.action, { method: 'POST', body: new FormData(form), headers: { Accept: 'application/json' } });
      const body = await res.json().catch(() => ({}));
      if (!res.ok || body.ok === false || body.errors) {
        throw new Error((body.errors || []).map((e) => e.message).join(' ') || body.error || `the form service answered ${res.status}`);
      }
      form.hidden = true;
      done.hidden = false;
    } catch (err) {
      error.textContent = `Sorry, the request did not go through (${err.message}). Please try again in a minute.`;
      error.hidden = false;
      button.disabled = false;
      button.textContent = 'Send request';
    }
  });
}
