// Checks that a rewrite is original and keeps the facts.

const norm = (s) => String(s).toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9 ]+/g, ' ').replace(/\s+/g, ' ').trim();

export function sentences(text) {
  return String(text || '')
    .split(/(?<=[.!?])\s+|\n+/)
    .map((s) => norm(s))
    .filter((s) => s.split(' ').length >= 3);
}

// Full-sentence overlap: an output sentence equal to a source sentence, an
// output sentence that appears inside the source text, or a source sentence
// copied inside an output sentence. `allow` lists stated facts (title,
// organiser, prize text...) that a description may legitimately repeat; a
// source "sentence" that is only one of those (a title used as a heading) is
// not counted.
export function sharedSentences(output, source, { allow = [] } = {}) {
  const allowed = allow.filter(Boolean).map((a) => ` ${norm(a)} `);
  const isFact = (t) => allowed.some((a) => a.includes(` ${t} `));
  const src = sentences(source).filter((t) => !isFact(t));
  if (!src.length) return [];
  const srcSet = new Set(src);
  const srcAll = ` ${norm(source)} `;
  const shared = [];
  for (const s of sentences(output)) {
    // A fragment of a stated fact ("Dr." or "P.A.C.E." split at a period)
    // is the fact itself, not copied prose.
    if (isFact(s)) continue;
    const words = s.split(' ').length;
    if (srcSet.has(s) || (words >= 5 && srcAll.includes(` ${s} `))) {
      shared.push(s);
      continue;
    }
    for (const t of src) {
      if (t.split(' ').length >= 5 && ` ${s} `.includes(` ${t} `)) {
        shared.push(t);
        break;
      }
    }
  }
  return shared;
}

// Longest run of consecutive words shared by the two texts (for reports).
export function longestSharedRun(output, source) {
  const a = norm(output).split(' ').filter(Boolean);
  const b = norm(source).split(' ').filter(Boolean);
  if (!a.length || !b.length) return { words: 0, text: '' };
  let best = 0;
  let end = 0;
  let prev = new Array(b.length + 1).fill(0);
  for (let i = 1; i <= a.length; i++) {
    const cur = new Array(b.length + 1).fill(0);
    for (let j = 1; j <= b.length; j++) {
      if (a[i - 1] === b[j - 1]) {
        cur[j] = prev[j - 1] + 1;
        if (cur[j] > best) { best = cur[j]; end = i; }
      }
    }
    prev = cur;
  }
  return { words: best, text: a.slice(end - best, end).join(' ') };
}

const MONTHS = ['january', 'february', 'march', 'april', 'may', 'june', 'july', 'august', 'september', 'october', 'november', 'december'];
const MONTH_RE = new RegExp(`\\b(${MONTHS.join('|')}|jan|feb|mar|apr|jun|jul|aug|sept?|oct|nov|dec)\\b`, 'gi');
const WEEKDAY_RE = /\b(monday|tuesday|wednesday|thursday|friday|saturday|sunday)\b/i;

const normNum = (s) => {
  let n = s.replace(/,/g, '');
  if (n.includes('.')) n = n.replace(/0+$/, '').replace(/\.$/, '');
  return n.replace(/^0+(?=\d)/, '');
};

export function numbersIn(text) {
  return (String(text || '').match(/\d[\d,]*(?:\.\d+)?/g) || []).map(normNum);
}

// Numbers and months the facts allow. Instants also allow the neighbouring
// day, because a time can fall on a different date in another time zone.
export function allowedTokens(facts) {
  const nums = new Set();
  const months = new Set();
  const addDate = (v) => {
    if (!v) return;
    const dates = [];
    if (/^\d{4}-\d{2}-\d{2}$/.test(v)) dates.push(new Date(`${v}T12:00:00Z`));
    else {
      const d = new Date(v);
      if (Number.isNaN(d.getTime())) return;
      dates.push(new Date(d.getTime() - 14 * 3600e3), d, new Date(d.getTime() + 14 * 3600e3));
      nums.add(String(d.getUTCHours()));
      nums.add(String(d.getUTCMinutes()));
    }
    for (const d of dates) {
      nums.add(String(d.getUTCFullYear()));
      nums.add(String(d.getUTCDate()));
      nums.add(String(d.getUTCMonth() + 1));
      months.add(MONTHS[d.getUTCMonth()]);
    }
  };
  for (const k of ['startDate', 'endDate', 'registrationDeadline']) addDate(facts[k]);
  for (const v of Object.values(facts)) {
    if (typeof v === 'string' || typeof v === 'number') for (const n of numbersIn(v)) nums.add(n);
    if (Array.isArray(v)) for (const x of v) for (const n of numbersIn(x)) nums.add(n);
  }
  return { nums, months };
}

export function factProblems(text, facts) {
  const problems = [];
  const { nums, months } = allowedTokens(facts);
  const badNums = numbersIn(text).filter((n) => !nums.has(n));
  if (badNums.length) problems.push(`numbers not in the facts: ${[...new Set(badNums)].join(', ')}`);
  const mentioned = (String(text).match(MONTH_RE) || []).map((m) => m.toLowerCase());
  const badMonths = mentioned.filter((m) => {
    const full = MONTHS.find((x) => x.startsWith(m.slice(0, 3)));
    // "may" is also an ordinary word; only flag it when capitalised.
    if (m === 'may' && !/\bMay\b/.test(text)) return false;
    return full && !months.has(full);
  });
  if (badMonths.length) problems.push(`months not in the facts: ${[...new Set(badMonths)].join(', ')}`);
  if (WEEKDAY_RE.test(text)) problems.push('mentions a day of the week, which the facts do not state');
  return problems;
}
