#!/usr/bin/env node
// Browser test of the "Claim this listing" flow on the built site.
//   CLAIM_FORM_ENDPOINT=https://formspree.io/f/test1234 npm run build
//   node scripts/test-claim-form.mjs [event-slug]
// Requests to the form service are intercepted, so nothing is sent anywhere.
// Writes screenshots to docs/screenshots/claim-*.png and the results to
// docs/claim-form-test.json.
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { createRequire } from 'node:module';
import { ROOT } from '../pipeline/config.mjs';

// Playwright is not a project dependency; use the copy installed on the
// machine (require() also searches NODE_PATH and global folders).
const { chromium } = createRequire(import.meta.url)('playwright');

const SITE = path.join(ROOT, '_site');
const slug = process.argv[2] || 'hellohacks-2026';
const TYPES = { '.html': 'text/html', '.css': 'text/css', '.js': 'text/javascript', '.json': 'application/json', '.svg': 'image/svg+xml', '.txt': 'text/plain' };

const server = http.createServer((req, res) => {
  let p = decodeURIComponent(new URL(req.url, 'http://x').pathname);
  if (p.endsWith('/')) p += 'index.html';
  const file = path.join(SITE, p);
  if (!file.startsWith(SITE) || !fs.existsSync(file)) { res.writeHead(404); res.end('not found'); return; }
  res.writeHead(200, { 'content-type': TYPES[path.extname(file)] || 'application/octet-stream' });
  fs.createReadStream(file).pipe(res);
});
await new Promise((r) => server.listen(0, r));
const origin = `http://localhost:${server.address().port}`;
const results = [];
const check = (name, ok, detail = '') => { results.push({ name, ok: Boolean(ok), detail }); console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail ? `: ${detail}` : ''}`); };
const shots = path.join(ROOT, 'docs', 'screenshots');
fs.mkdirSync(shots, { recursive: true });

const browser = await chromium.launch();
try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  const posts = [];
  let reply = { status: 200, body: { ok: true, next: 'https://formspree.io/thanks' } };
  await page.route(/formspree\.io/, async (route) => {
    const req = route.request();
    posts.push({ url: req.url(), method: req.method(), accept: req.headers().accept, body: req.postData() || '' });
    await route.fulfill({ status: reply.status, contentType: 'application/json', body: JSON.stringify(reply.body) });
  });

  // 1. The event page links to the claim form.
  await page.goto(`${origin}/hackathons/${slug}/`);
  const link = page.getByRole('link', { name: 'Claim this listing' });
  check('event page shows a "Claim this listing" link', await link.count() === 1);
  await link.click();
  await page.waitForURL(/\/claim\/\?event=/);
  const action = await page.getAttribute('#claim-form', 'action');
  check('claim form posts to the configured form endpoint', /^https:\/\/formspree\.io\/f\//.test(action || ''), action);
  check('claim form uses POST', (await page.getAttribute('#claim-form', 'method')) === 'POST');

  // 2. The listing is filled in from the link.
  const listing = await page.inputValue('#claim-listing');
  check('listing URL is filled in from the event link', listing === `${origin}/hackathons/${slug}/`, listing);
  check('event title is shown above the form', /^Listing: .+/.test(await page.textContent('#claim-event')), await page.textContent('#claim-event'));
  check('email subject names the event', /listing claim: .+/.test(await page.inputValue('#claim-subject')), await page.inputValue('#claim-subject'));
  check('page is not indexed', (await page.locator('meta[name="robots"]').getAttribute('content'))?.includes('noindex'));
  await page.screenshot({ path: path.join(shots, 'claim-form-desktop.png'), fullPage: true });

  // 3. Required fields: an empty or invalid form is never sent.
  await page.click('#claim-submit');
  check('empty form is blocked by the browser (required fields)', posts.length === 0 && await page.$eval('#claim-form', (f) => !f.checkValidity()));
  await page.fill('input[name="name"]', 'Ada Example');
  await page.fill('input[name="organisation"]', 'Testville University');
  await page.fill('input[name="email"]', 'not-an-email');
  await page.fill('textarea[name="changes"]', 'The registration deadline moved to 30 November 2026.');
  await page.click('#claim-submit');
  check('invalid email is blocked', posts.length === 0 && await page.$eval('input[name="email"]', (i) => !i.validity.valid));

  // 4. A valid form is sent once with every field, and a confirmation shows.
  await page.fill('input[name="email"]', 'ada@example.org');
  await page.click('#claim-submit');
  await page.waitForSelector('#claim-done:not([hidden])');
  const sent = posts[0] || { body: '' };
  const has = (field, value) => sent.body.includes(`name="${field}"`) && (value === undefined || sent.body.includes(value));
  check('one request sent to the form endpoint', posts.length === 1, posts[0]?.url);
  check('request asks for a JSON reply (no page change)', sent.accept === 'application/json');
  check('payload has name, organisation, email, changes and listing', ['name', 'organisation', 'email', 'changes', 'listing'].every((f) => has(f)) && has('email', 'ada@example.org') && has('listing', `/hackathons/${slug}/`));
  check('spam trap field is sent empty', /name="_gotcha"\r\n\r\n\r\n/.test(sent.body));
  check('confirmation shown and form hidden', await page.isVisible('#claim-done') && await page.isHidden('#claim-form'));
  await page.screenshot({ path: path.join(shots, 'claim-form-sent.png') });

  // 5. A refusal from the form service is shown, and the form can be resent.
  reply = { status: 422, body: { error: 'Validation errors', errors: [{ code: 'TYPE_EMAIL', field: 'email', message: 'should be an email' }] } };
  await page.goto(`${origin}/claim/?event=${slug}&title=Test`);
  await page.fill('input[name="name"]', 'Ada Example');
  await page.fill('input[name="organisation"]', 'Testville University');
  await page.fill('input[name="email"]', 'ada@example.org');
  await page.fill('textarea[name="changes"]', 'Please update the prize list.');
  await page.click('#claim-submit');
  await page.waitForSelector('#claim-error:not([hidden])');
  check('an error from the form service is shown', /should be an email/.test(await page.textContent('#claim-error')));
  check('the button is enabled again after an error', await page.isEnabled('#claim-submit'));
  check('no script errors on the claim page', errors.length === 0, errors.join('; '));

  // 6. Without JavaScript the form still posts natively to the endpoint.
  const noJs = await browser.newContext({ javaScriptEnabled: false, viewport: { width: 390, height: 844 } });
  const p2 = await noJs.newPage();
  let nativePost = null;
  await p2.route(/formspree\.io/, async (route) => {
    nativePost = route.request().postData() || '';
    await route.fulfill({ status: 200, contentType: 'text/html', body: '<p>Thanks</p>' });
  });
  await p2.goto(`${origin}/claim/`);
  await p2.screenshot({ path: path.join(shots, 'claim-form-phone-nojs.png'), fullPage: true });
  await p2.fill('input[name="listing"]', `https://hackathon.so/hackathons/${slug}/`);
  await p2.fill('input[name="name"]', 'Ada Example');
  await p2.fill('input[name="organisation"]', 'Testville University');
  await p2.fill('input[name="email"]', 'ada@example.org');
  await p2.fill('textarea[name="changes"]', 'Typo in the title.');
  await Promise.all([p2.waitForURL(/formspree\.io/), p2.click('#claim-submit')]);
  check('without JavaScript the form posts directly to the endpoint', Boolean(nativePost) && /email=ada%40example\.org/.test(nativePost), (nativePost || '').slice(0, 120));
  const width = await p2.evaluate(() => document.documentElement.scrollWidth);
  check('claim page fits a 390px phone screen', width <= 390, `${width}px`);
  await noJs.close();
} finally {
  await browser.close();
  server.close();
}
const failed = results.filter((r) => !r.ok);
fs.writeFileSync(path.join(ROOT, 'docs', 'claim-form-test.json'), JSON.stringify({ ranAt: new Date().toISOString(), event: slug, passed: results.length - failed.length, failed: failed.length, results }, null, 2) + '\n');
console.log(`${results.length - failed.length} of ${results.length} checks passed`);
process.exit(failed.length ? 1 : 0);
