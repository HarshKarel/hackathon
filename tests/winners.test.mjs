import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { devfolioWinners, devpostWinners, parseDevpostGallery, parseDevpostProject, winnersCandidates } from '../pipeline/lib/winners.mjs';
import { checkEvent } from '../pipeline/winners.mjs';

const fx = (f) => fs.readFileSync(new URL(`./fixtures/${f}`, import.meta.url), 'utf8');
const NOW = new Date('2026-10-27T12:00:00Z');

test('Devpost gallery: winners first, names decoded, pages counted', () => {
  const g = parseDevpostGallery(fx('devpost-gallery.html'));
  assert.equal(g.items.length, 3);
  assert.deepEqual(g.items.map((i) => i.winner), [true, true, false]);
  assert.equal(g.items[1].project, 'Quiet & Lab');
  assert.equal(g.items[0].projectUrl, 'https://devpost.com/software/river-watch');
  assert.equal(g.lastPage, 2);
});

test('Devpost project: places for this hackathon only, team as listed', () => {
  const p = parseDevpostProject(fx('devpost-project.html'), 'testville-hacks.devpost.com');
  assert.deepEqual(p.places, ['Best Use of Open Data', '1st Place – Overall']);
  assert.deepEqual(p.team, ['Ada Example', 'Bo Sample']);
});

const GALLERY_EMPTY = '<html><div id="submission-gallery"><div class="row"></div></div></html>';

function fakeHttp(pages) {
  const calls = [];
  return {
    calls,
    async getText(url) { calls.push(url); if (!(url in pages)) throw new Error(`HTTP 404 for ${url}`); return pages[url]; },
    async getJson(url) { calls.push(url); if (!(url in pages)) throw new Error(`HTTP 404 for ${url}`); return pages[url]; },
  };
}

test('Devpost winners: one row per place, stops at the first non-winner', async () => {
  const http = fakeHttp({
    'https://testville-hacks.devpost.com/project-gallery': fx('devpost-gallery.html'),
    'https://devpost.com/software/river-watch': fx('devpost-project.html'),
    'https://devpost.com/software/quiet-lab': '<html></html>',
  });
  const r = await devpostWinners(http, 'https://testville-hacks.devpost.com/');
  assert.deepEqual(r.winners, [
    { place: 'Best Use of Open Data', project: 'River Watch', projectUrl: 'https://devpost.com/software/river-watch', team: 'Ada Example, Bo Sample' },
    { place: '1st Place – Overall', project: 'River Watch', projectUrl: 'https://devpost.com/software/river-watch', team: 'Ada Example, Bo Sample' },
    { place: 'Winner', project: 'Quiet & Lab', projectUrl: 'https://devpost.com/software/quiet-lab', team: null },
  ]);
  assert.ok(!http.calls.some((u) => u.includes('page=2')), 'page 2 not fetched once a non-winner appears');
});

test('Devfolio winners: prize name as place, team name as stated, project link from slug', async () => {
  const api = 'https://api.devfolio.co/api';
  const http = fakeHttp({
    [`${api}/hackathons/abc/prizes`]: [
      { name: 'The Winner', projects: [{ name: 'gps-denied car', uuid: 'p1', team: { name: 'FINE TUNE' } }] },
      { name: 'Best Beginner Team', projects: [] },
    ],
    [`${api}/projects/p1`]: { project: { slug: 'gpsdenied-car-22f9' } },
  });
  const r = await devfolioWinners(http, 'abc');
  assert.deepEqual(r.winners, [{ place: 'The Winner', project: 'gps-denied car', projectUrl: 'https://devfolio.co/projects/gpsdenied-car-22f9', team: 'FINE TUNE' }]);
});

const ev = (slug, endDate, sources, extra = {}) => ({ slug, startDate: endDate, endDate, sources, published: true, ...extra });
const dp = (id) => ({ platform: 'devpost', sourceId: id, url: `https://${id}.devpost.com/` });

test('candidates: ended in the last 60 days, winners empty, Devpost or Devfolio listed', () => {
  const events = [
    ev('recent', '2026-10-20', [dp('recent')]),
    ev('old', '2026-07-01', [dp('old')]),
    ev('upcoming', '2026-11-20', [dp('upcoming')]),
    ev('mlh-only', '2026-10-20', [{ platform: 'mlh', sourceId: 'm', url: 'https://www.mlh.com/events/m' }]),
    ev('has-winners', '2026-10-20', [dp('hw')]),
    ev('not-published', '2026-10-20', [dp('np')]),
  ];
  const winners = { 'has-winners': { winnersStatus: 'published', winners: [{ place: 'Winner' }] }, 'not-published': { winnersStatus: 'not published', winners: [] } };
  assert.deepEqual(winnersCandidates(events, winners, { now: NOW, windowDays: 60 }).map((e) => e.slug), ['recent', 'not-published']);
});

test('checkEvent: nothing published is stated explicitly; failures keep the old entry', async () => {
  const e = ev('quiet', '2026-10-20', [dp('quiet')]);
  const empty = fakeHttp({ 'https://quiet.devpost.com/project-gallery': GALLERY_EMPTY });
  const r = await checkEvent(e, empty, NOW);
  assert.equal(r.entry.winnersStatus, 'not published');
  assert.deepEqual(r.entry.checked, ['devpost']);
  const down = fakeHttp({});
  const r2 = await checkEvent(e, down, NOW);
  assert.equal(r2.entry, null, 'a failed check never writes "not published"');
  assert.equal(r2.failures.length, 1);
});

test('checkEvent: one platform failing keeps the old entry even when another says nothing published', async () => {
  const e = ev('both', '2026-10-20', [dp('both'), { platform: 'devfolio', sourceId: 'dfid', url: 'https://both.devfolio.co/' }]);
  const http = fakeHttp({ 'https://both.devpost.com/project-gallery': GALLERY_EMPTY });
  const r = await checkEvent(e, http, NOW);
  assert.equal(r.entry, null);
  assert.match(r.failures[0], /^devfolio:/);
});

test('Devpost winners: an unrecognised gallery page or a failed project page fails the check', async () => {
  const odd = fakeHttp({ 'https://odd.devpost.com/project-gallery': '<html><p>Please wait</p></html>' });
  await assert.rejects(devpostWinners(odd, 'https://odd.devpost.com/'), /unrecognised project gallery/);
  const noProject = fakeHttp({ 'https://testville-hacks.devpost.com/project-gallery': fx('devpost-gallery.html') });
  await assert.rejects(devpostWinners(noProject, 'https://testville-hacks.devpost.com/'), /HTTP 404/);
});

test('Devfolio winners: members named when the team has no name; bad responses fail the check', async () => {
  const api = 'https://api.devfolio.co/api';
  const http = fakeHttp({
    [`${api}/hackathons/abc/prizes`]: [{ name: 'Track Winner', projects: [{ name: 'Solo', uuid: 'p2', team: {} }] }],
    [`${api}/projects/p2`]: { project: { slug: 'solo-1a2b' }, members: [{ first_name: 'Ada', last_name: 'Example' }, { first_name: 'Bo', last_name: '' }] },
  });
  const r = await devfolioWinners(http, 'abc');
  assert.equal(r.winners[0].team, 'Ada Example, Bo');
  await assert.rejects(devfolioWinners(fakeHttp({ [`${api}/hackathons/x/prizes`]: { error: 'nope' } }), 'x'), /unexpected Devfolio prizes/);
  const lost = fakeHttp({ [`${api}/hackathons/abc/prizes`]: [{ name: 'Track Winner', projects: [{ name: 'Solo', uuid: 'p2' }] }] });
  await assert.rejects(devfolioWinners(lost, 'abc'), /HTTP 404/);
});
