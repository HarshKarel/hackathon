import { normaliseListing } from '../pipeline/lib/record.mjs';

export const NOW = new Date('2026-10-27T12:00:00Z');

export function rec(overrides = {}) {
  const { record } = normaliseListing({
    platform: 'devpost',
    sourceId: '1',
    url: 'https://example.devpost.com/',
    title: 'Example Hacks',
    startDate: '2026-11-14',
    endDate: '2026-11-15',
    mode: 'online',
    ...overrides,
  }, NOW);
  return record;
}

export function item(overrides = {}, sourceText = '') {
  return { record: rec(overrides), sourceText };
}
