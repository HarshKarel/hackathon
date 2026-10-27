import test from 'node:test';
import assert from 'node:assert/strict';
import { isAllowed, parseRobots } from '../pipeline/lib/robots.mjs';

test('empty Disallow allows everything', () => {
  const g = parseRobots('User-agent: *\nDisallow:\n\nUser-agent: BLEXBot\nDisallow: /');
  assert.equal(isAllowed(g, 'hackathon.so-bot', '/api/hackathons?page=1'), true);
});

test('specific paths and wildcards are honoured', () => {
  const g = parseRobots('User-agent: *\nDisallow: /account/\nDisallow: /events/*/partners/*/promo_codes/\nAllow: /');
  assert.equal(isAllowed(g, 'hackathon.so-bot', '/seasons/2027/events'), true);
  assert.equal(isAllowed(g, 'hackathon.so-bot', '/account/settings'), false);
  assert.equal(isAllowed(g, 'hackathon.so-bot', '/events/x/partners/y/promo_codes/'), false);
});

test('a group naming our bot overrides the * group', () => {
  const g = parseRobots('User-agent: *\nAllow: /\n\nUser-agent: hackathon.so-bot\nDisallow: /private');
  assert.equal(isAllowed(g, 'hackathon.so-bot', '/private/x'), false);
  assert.equal(isAllowed(g, 'hackathon.so-bot', '/public'), true);
});

test('longest match wins, Allow wins ties', () => {
  const g = parseRobots('User-agent: *\nDisallow: /a\nAllow: /a/b');
  assert.equal(isAllowed(g, 'bot', '/a/b/c'), true);
  assert.equal(isAllowed(g, 'bot', '/a/c'), false);
});
