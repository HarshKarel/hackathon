import test from 'node:test';
import assert from 'node:assert/strict';
import { normaliseEligibility } from '../pipeline/lib/eligibility.mjs';
import { tagNiches } from '../pipeline/lib/niches.mjs';

test('eligibility filter values', () => {
  assert.equal(normaliseEligibility('Above legal age of majority in country of residence; All countries/territories, excluding standard exceptions'), 'open');
  assert.equal(normaliseEligibility('Ages 13+ only; High school students only; Companies/professional organizations excluded from participation'), 'students');
  assert.equal(normaliseEligibility('Open to professionals and students'), 'mixed');
  assert.equal(normaliseEligibility('Working professionals only'), 'professionals');
  assert.equal(normaliseEligibility('Women only'), 'mixed');
  assert.equal(normaliseEligibility('', { inviteOnly: true }), 'mixed');
  assert.equal(normaliseEligibility(null), null);
  assert.equal(normaliseEligibility(null, { defaultValue: 'students' }), 'students');
});

test('niches: 1 to 3 from the fixed list, platform defaults, Open fallback', () => {
  assert.deepEqual(tagNiches({ title: 'ETHGlobal Lisbon', platformDefaults: ['Web3'] }), ['Web3']);
  assert.deepEqual(tagNiches({ title: 'Untitled Event' }), ['Open']);
  const many = tagNiches({ title: 'AI Health Fintech Climate Game Jam', themes: ['Machine Learning/AI', 'Health', 'Fintech', 'Gaming'] });
  assert.ok(many.length <= 3 && many.length >= 1);
  assert.ok(many.includes('AI and ML'));
  // "Robotic Process Automation" is software, not hardware.
  assert.ok(!tagNiches({ title: 'X', themes: ['Robotic Process Automation'] }).includes('Hardware'));
});
