import test from 'node:test';
import assert from 'node:assert/strict';
import { deriveSeries } from '../pipeline/lib/series.mjs';

const ev = (slug, title, startDate, extra = {}) => ({ slug, title, startDate, organiser: null, series: null, ...extra });

test('titles that differ only by edition form a series', () => {
  const es = [ev('a', 'Next Byte Hacks: V4', '2026-09-05'), ev('b', 'Next Byte Hacks V5', '2026-10-06')];
  const found = deriveSeries(es);
  assert.equal(found.length, 1);
  assert.equal(es[0].series, 'Next Byte Hacks');
  assert.equal(es[1].series, 'Next Byte Hacks');
});

test('explicit series win; generic names and conflicting organisers do not group', () => {
  const eth = ev('e', 'ETHGlobal Lisbon 2026', '2026-07-24', { series: 'ETHGlobal' });
  const g = [ev('g1', 'HACK 6.0', '2027-01-22'), ev('g2', ".hack '26", '2026-09-04')];
  const c = [ev('c1', 'Code Sprint 2026', '2026-01-01', { organiser: 'A' }), ev('c2', 'Code Sprint 2027', '2027-01-01', { organiser: 'B' })];
  assert.equal(deriveSeries([eth, ...g, ...c]).length, 0);
  assert.equal(eth.series, 'ETHGlobal');
  assert.equal(g[0].series, null);
});

test('identical titles need the same stated organiser on every edition', () => {
  const a = [ev('x1', 'The Great Agent Hackathon', '2026-07-23', { organiser: 'WIP' }), ev('x2', 'The Great Agent Hackathon', '2026-09-25')];
  assert.equal(deriveSeries(a).length, 0);
  const b = [ev('y1', 'Builders Night', '2026-07-23', { organiser: 'WIP' }), ev('y2', 'Builders Night', '2026-09-25', { organiser: 'WIP' })];
  assert.equal(deriveSeries(b).length, 1);
});
