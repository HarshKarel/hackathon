// Text helpers shared by adapters, the rewrite engine and the site.

const NAMED = {
  amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', rsquo: '’', lsquo: '‘',
  rdquo: '”', ldquo: '“', hellip: '…', ndash: '\u2013', mdash: '\u2014', middot: '·',
  copy: '©', reg: '®', trade: '™', euro: '€', pound: '£', yen: '¥', rupee: '₹',
};

export function decodeEntities(s) {
  return String(s ?? '').replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, code) => {
    if (code[0] === '#') {
      const n = code[1].toLowerCase() === 'x' ? parseInt(code.slice(2), 16) : parseInt(code.slice(1), 10);
      return Number.isFinite(n) ? String.fromCodePoint(n) : m;
    }
    return NAMED[code.toLowerCase()] ?? m;
  });
}

export function stripTags(s) {
  return String(s ?? '').replace(/<script[\s\S]*?<\/script>/gi, ' ').replace(/<style[\s\S]*?<\/style>/gi, ' ').replace(/<[^>]+>/g, ' ');
}

// Typographic normalisation for any text that reaches the site: em dashes
// become a spaced hyphen. No words or numbers change.
export function noEmDash(s) {
  return String(s ?? '').replace(/\s*\u2014\s*/g, ' - ');
}

// Clean a stated fact (title, prize, eligibility) for display.
export function cleanFact(s) {
  if (s == null) return null;
  const out = noEmDash(decodeEntities(stripTags(s))).replace(/\s+/g, ' ').trim();
  return out || null;
}

// Plain source text used only for the copy check and hashing.
export function plainText(s) {
  if (s == null) return '';
  return decodeEntities(stripTags(String(s)))
    .replace(/[#*_`>]+/g, ' ') // markdown markers
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{2,}/g, '\n')
    .trim();
}

export function slugify(s) {
  return String(s ?? '')
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80)
    .replace(/-+$/g, '');
}

// Normalised title for dedupe: lowercase, no accents or punctuation,
// no 4-digit years.
export function normTitle(s) {
  return String(s ?? '')
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/\b(19|20)\d{2}\b/g, ' ')
    .replace(/'s\b/g, 's')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

// Edition markers: "12", "13.0", "9.O", "V5", "S2", "Season 3", "3rd edition".
const EDITION = /\b(v|s|season|edition|ed)\s*\d+(\.\d+)?\b|\b\d+(st|nd|rd|th)\s+edition\b|\b\d+(\.(\d+|o))?\b|\bedition\b/g;

// Title key for dedupe and series: normTitle without edition markers, so
// "SpartaHack 12" (Devpost) and "SpartaHack" (MLH) compare equal.
export function editionlessTitle(s) {
  return normTitle(s).replace(/\b\d+ o\b/g, ' ').replace(EDITION, ' ').replace(/\s+/g, ' ').trim();
}

// Display name for a series: the title without its year or edition marker.
export function seriesNameFrom(title) {
  return String(title)
    .replace(/\b(19|20)\d{2}\b/g, ' ')
    .replace(/'\d{2}\b/g, ' ')
    .replace(/\b(v|s|season|edition|ed)\s*\d+(\.\d+)?\b/gi, ' ')
    .replace(/\b\d+(st|nd|rd|th)\s+edition\b/gi, ' ')
    .replace(/(?<![\w-])\d+(\.(\d+|o))?(?![\w-])/gi, ' ')
    .replace(/\s+/g, ' ')
    .replace(/[\s:|,(\-]+$/g, '')
    .replace(/^[\s:|,\-]+/g, '')
    .trim();
}

export function normOrganiser(s) {
  return String(s ?? '')
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/\b(inc|llc|ltd|limited|corp|corporation|gmbh|team|the|org|club)\b/g, ' ')
    .replace(/[^a-z0-9]+/g, '')
    .trim();
}

export function wordCount(s) {
  return String(s ?? '').trim().split(/\s+/).filter(Boolean).length;
}
