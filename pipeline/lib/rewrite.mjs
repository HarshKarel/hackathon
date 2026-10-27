// Rewrite engine. Each event's source facts are hashed; only new or changed
// events go to the AI. Output must be 80 to 140 words, one summary line,
// no em dashes, no sentence shared with the source text, and no number or
// month the facts do not contain. A failed check gets one retry with the
// reasons; a second failure flags the event for human review.
import crypto from 'node:crypto';
import { PLATFORMS, REWRITE, SOURCE_PRIORITY } from '../config.mjs';
import { factProblems, sharedSentences, longestSharedRun } from './copycheck.mjs';
import { isDateOnly } from './dates.mjs';
import { wordCount } from './text.mjs';

const FACT_KEYS = [
  'title', 'organiser', 'series', 'startDate', 'endDate', 'registrationDeadline', 'deadlineKind', 'timezone',
  'mode', 'city', 'country', 'locationText', 'prizeText', 'eligibilityText', 'teamSizeText', 'niches',
];

export function factsFor(e) {
  const f = {};
  for (const k of FACT_KEYS) if (e[k] != null && !(Array.isArray(e[k]) && !e[k].length)) f[k] = e[k];
  const rank = (p) => (SOURCE_PRIORITY.indexOf(p) + 100) % 100;
  const platforms = [...new Set(e.sources.map((s) => s.platform))].sort((a, b) => rank(a) - rank(b));
  f.listedOn = platforms.map((p) => PLATFORMS[p]?.name || p);
  return f;
}

export function factsHash(e, sourceText) {
  const facts = factsFor(e);
  delete facts.niches; // tagging tweaks should not trigger a rewrite
  return crypto.createHash('sha256').update(JSON.stringify(facts)).update('\n').update(sourceText || '').digest('hex').slice(0, 16);
}

// ---------- placeholder (no AI key) ----------

const fmtDay = (v) => {
  const d = isDateOnly(v) ? new Date(`${v}T12:00:00Z`) : new Date(v);
  return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' });
};
const fmtWhen = (v) => (isDateOnly(v) ? fmtDay(v) : `${fmtDay(v)} (${new Date(v).toISOString().slice(11, 16)} UTC)`);

const MODE_WORDS = { online: 'an online', 'in-person': 'an in-person', hybrid: 'a hybrid (in-person and online)' };

export function placeholderFor(e) {
  const where = e.mode === 'online' ? '' : e.city && e.country ? ` in ${e.city}, ${e.country}` : e.country ? ` in ${e.country}` : '';
  const by = e.organiser ? `, organised by ${e.organiser}` : '';
  const parts = [];
  parts.push(`${e.title} is ${MODE_WORDS[e.mode]} hackathon${where}${by}.`);
  const sameDay = (e.endDate || e.startDate).slice(0, 10) === e.startDate.slice(0, 10);
  parts.push(sameDay ? `It takes place on ${fmtDay(e.startDate)}.` : `It runs from ${fmtDay(e.startDate)} to ${fmtDay(e.endDate)}.`);
  if (e.registrationDeadline) parts.push(`The listed ${e.deadlineKind === 'submission' ? 'submission' : 'registration'} deadline is ${fmtWhen(e.registrationDeadline)}.`);
  // Prize, eligibility and team size are shown as stated in their own
  // sections of the page, so the placeholder does not repeat them.
  const platforms = [...new Set(e.sources.map((s) => PLATFORMS[s.platform]?.name || s.platform))];
  parts.push(`Full details and registration are on ${platforms.join(' and ')}.`);
  const summaryBits = [
    e.mode === 'online' ? 'Online hackathon' : e.mode === 'hybrid' ? 'Hybrid hackathon' : `In-person hackathon${e.city ? ` in ${e.city}` : e.country ? ` in ${e.country}` : ''}`,
    sameDay ? fmtDay(e.startDate) : `${fmtDay(e.startDate)} to ${fmtDay(e.endDate)}`,
  ];
  return {
    description: parts.join(' ').replace(/\.\./g, '.'),
    summary: summaryBits.join(', ') + '.',
  };
}

// ---------- AI rewrite ----------

export const SYSTEM_PROMPT = `You write short, original descriptions of hackathons for hackathon.so, a worldwide hackathon directory.
You get verified facts and, separately, the listing text the organiser published. Write in your own words.
Rules:
1. Use only the facts given. Do not add prizes, dates, sponsors, themes, numbers or claims that are not in the facts.
2. Every date, time, number, amount and place you mention must match the facts exactly. Do not convert time zones. Do not mention days of the week.
3. Do not copy any sentence or distinctive phrase from the listing text. It is there only so you understand what the event is about.
4. Never use em dashes. Use commas, full stops or parentheses instead.
5. Neutral, factual tone. No hype, no exclamation marks, no questions, no "you".
6. The description is 80 to 140 words in one or two paragraphs. The summary is one line of at most 150 characters.
Return only a JSON object: {"summary": "...", "description": "..."}`;

export function buildUserPrompt(facts, sourceText, previousProblems = []) {
  let u = `Facts (JSON):\n${JSON.stringify(facts, null, 2)}\n\nListing text, for understanding only, do not copy:\n"""\n${(sourceText || '(none)').slice(0, 2000)}\n"""`;
  if (previousProblems.length) {
    u += `\n\nYour previous draft was rejected for these reasons:\n- ${previousProblems.join('\n- ')}\nWrite a new version that fixes all of them.`;
  }
  return u;
}

export function parseModelJson(text) {
  const m = String(text).match(/\{[\s\S]*\}/);
  if (!m) throw new Error('no JSON object in model output');
  const obj = JSON.parse(m[0]);
  if (typeof obj.description !== 'string' || typeof obj.summary !== 'string') throw new Error('JSON missing description or summary');
  return { description: obj.description.trim(), summary: obj.summary.trim() };
}

// Stated facts a description may repeat word for word.
export const statedFacts = (f) => [f.title, f.organiser, f.series, f.prizeText, f.eligibilityText, f.teamSizeText, f.locationText, f.city, f.country];

export function checkRewrite(out, sourceText, facts) {
  const problems = [];
  const words = wordCount(out.description);
  if (words < REWRITE.minWords || words > REWRITE.maxWords) problems.push(`description is ${words} words; it must be ${REWRITE.minWords} to ${REWRITE.maxWords}`);
  if (!out.summary || /\n/.test(out.summary) || out.summary.length > REWRITE.maxSummaryChars) problems.push(`summary must be one line of at most ${REWRITE.maxSummaryChars} characters`);
  if (/\u2014/.test(out.description + out.summary)) problems.push('contains an em dash');
  const shared = sharedSentences(`${out.description}\n${out.summary}`, sourceText, { allow: statedFacts(facts) });
  if (shared.length) problems.push(`shares a full sentence with the listing text: "${shared[0]}"`);
  problems.push(...factProblems(`${out.description} ${out.summary}`, facts));
  return problems;
}

// Returns { description, summary, descriptionStatus, attempts, problems, longestRun }
export async function rewriteEvent(e, sourceText, llm) {
  const facts = factsFor(e);
  let problems = [];
  let lastOut = null;
  let attempts = 0;
  for (let i = 0; i < REWRITE.maxAttempts; i++) {
    attempts += 1;
    let out;
    try {
      out = parseModelJson(await llm.complete({ system: SYSTEM_PROMPT, user: buildUserPrompt(facts, sourceText, problems) }));
    } catch (err) {
      problems = [`AI call failed: ${err.message}`];
      continue;
    }
    lastOut = out;
    problems = checkRewrite(out, sourceText, facts);
    if (!problems.length) {
      return { ...out, descriptionStatus: 'ai', attempts, problems: [], longestRun: longestSharedRun(out.description, sourceText).words };
    }
  }
  // Every attempt failed at the API (outage, rate limit, bad key or model):
  // nothing was rejected, so this is not a review case. The caller keeps a
  // flagged placeholder and tries again on the next run.
  if (!lastOut) return { description: null, summary: null, descriptionStatus: 'error', attempts, problems };
  return {
    description: null,
    summary: null,
    rejected: lastOut,
    descriptionStatus: 'review',
    attempts,
    problems,
  };
}
