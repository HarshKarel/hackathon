// Claim form: fills in the listing from ?event=<slug> and sends the form to
// the form service (Formspree) without leaving the page. Without JavaScript
// the form still posts normally.
//
// The event title shown above the form is read from our own event page for
// that slug, never from the address, so nobody can put their own words on
// this page with a crafted link.
const slug = new URLSearchParams(location.search).get('event') || '';
const form = document.getElementById('claim-form');

async function titleFor(s) {
  try {
    const res = await fetch(`/hackathons/${s}/`);
    if (!res.ok) return null;
    const doc = new DOMParser().parseFromString(await res.text(), 'text/html');
    return doc.querySelector('h1')?.textContent.trim().slice(0, 200) || null;
  } catch {
    return null;
  }
}

if (/^[a-z0-9-]{1,120}$/.test(slug)) {
  const listing = document.getElementById('claim-listing');
  if (listing && !listing.value) listing.value = `${location.origin}/hackathons/${slug}/`;
  titleFor(slug).then((title) => {
    if (!title) return; // unknown listing: the URL field is still filled in
    const label = document.getElementById('claim-event');
    label.textContent = `Listing: ${title}`;
    label.hidden = false;
    const subject = document.getElementById('claim-subject');
    if (subject) subject.value = `hackathon.so listing claim: ${title}`;
  });
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
