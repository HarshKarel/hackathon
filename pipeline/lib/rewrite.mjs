// Rewrite engine. Each event's source facts are hashed; only new or changed
// events go to the AI. Output must be 80 to 140 words, one summary line,
// no em dashes, no sentence shared with the source text, and no number or
// month the facts do not contain. A failed check gets one retry with the
// reasons; a second failure flags the event for human review.
//
// All pending events of a run go to Gemini together through the shared AI
// flow (lib/aiflow.mjs): one Batch API job for 10 or more events, standard
// requests below that. Retries for rejected drafts form a second round.
import crypto from 'node:crypto';
import { AI, PLATFORMS, REWRITE, SOURCE_PRIORITY } from '../config.mjs';
import { factProblems, sharedSentences, longestSharedRun } from './copycheck.mjs';
import { loadPending, roundSummary, runRequests, savePending } from './aiflow.mjs';
import { addUsage, batchState, redact, responseText, usageOf } from './gemini.mjs';
import { isDateOnly } from './dates.mjs';
import { wordCount } from './text.mjs';

const FACT_KEYS = [
  'title', 'organiser', 'series', 'startDate', 'endDate', 'registrationDeadline', 'deadlineKind', 'timezone',
  'mode', 'city', 'country', 'locationText', 'prizeText', 'eligibilityText', 'teamSizeText', 'niches',
];

export function factsFor(e) {
  const f = {};
  // Only non-default types are part of the facts, so adding the field did
  // not change the hash (and trigger a rewrite) for every existing hackathon.
  if (e.type && e.type !== 'hackathon') f.type = e.type;
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
  const noun = e.type === 'competition' ? 'competition' : 'hackathon';
  parts.push(`${e.title} is ${MODE_WORDS[e.mode]} ${noun}${where}${by}.`);
  const sameDay = (e.endDate || e.startDate).slice(0, 10) === e.startDate.slice(0, 10);
  parts.push(sameDay ? `It takes place on ${fmtDay(e.startDate)}.` : `It runs from ${fmtDay(e.startDate)} to ${fmtDay(e.endDate)}.`);
  if (e.registrationDeadline) parts.push(`The listed ${e.deadlineKind === 'submission' ? 'submission' : 'registration'} deadline is ${fmtWhen(e.registrationDeadline)}.`);
  // Prize, eligibility and team size are shown as stated in their own
  // sections of the page, so the placeholder does not repeat them.
  const platforms = [...new Set(e.sources.map((s) => PLATFORMS[s.platform]?.name || s.platform))];
  parts.push(`Full details and registration are on ${platforms.join(' and ')}.`);
  const summaryBits = [
    e.mode === 'online' ? `Online ${noun}` : e.mode === 'hybrid' ? `Hybrid ${noun}` : `In-person ${noun}${e.city ? ` in ${e.city}` : e.country ? ` in ${e.country}` : ''}`,
    sameDay ? fmtDay(e.startDate) : `${fmtDay(e.startDate)} to ${fmtDay(e.endDate)}`,
  ];
  return {
    description: parts.join(' ').replace(/\.\./g, '.'),
    summary: summaryBits.join(', ') + '.',
  };
}

// ---------- AI rewrite ----------

export const SYSTEM_PROMPT = `You write short, original descriptions of hackathons and competitions for hackathon.so, a worldwide hackathon directory. If the facts give a "type" of "competition", call the event a competition, not a hackathon.
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

// One Gemini generateContent request for an event.
export function rewriteRequest(facts, sourceText, previousProblems = []) {
  return {
    systemInstruction: { parts: [{ text: SYSTEM_PROMPT }] },
    contents: [{ role: 'user', parts: [{ text: buildUserPrompt(facts, sourceText, previousProblems) }] }],
    generationConfig: {
      responseMimeType: 'application/json',
      responseJsonSchema: {
        type: 'object',
        properties: { summary: { type: 'string' }, description: { type: 'string' } },
        required: ['summary', 'description'],
        propertyOrdering: ['summary', 'description'],
      },
      thinkingConfig: { thinkingLevel: AI.thinkingLevel },
      maxOutputTokens: AI.maxOutputTokens,
    },
    store: false,
  };
}

// Rewrite many events through the shared AI flow.
//   entries    [{ e, sourceText }]
//   prefilled  Map(slug -> { text | error, factsHash, usage }) results collected
//              from a batch job an earlier run left running; used as round 1
//              only when they were written for the event's current facts
// Returns { outcomes: Map(slug -> outcome), rounds: [...] } where an outcome is
//   { descriptionStatus: 'ai', description, summary, attempts, longestRun }
//   { descriptionStatus: 'review', rejected, problems, attempts }   two drafts failed the checks
//   { descriptionStatus: 'error', problems, attempts }              no usable draft came back at all
//   { descriptionStatus: 'pending', jobId }                         batch job still running
export async function rewriteMany(entries, ai, {
  log = () => {}, now = new Date(), prefilled = new Map(), onSubmitted, onCollected, minBatch, pollMs, maxWaitMs,
} = {}) {
  const st = entries.map(({ e, sourceText }) => ({ e, sourceText: sourceText || '', facts: factsFor(e), problems: [], lastOut: null, lastError: null, attempts: 0, done: false }));
  const rounds = [];
  // One waiting budget for the whole run, shared by both rounds.
  const deadline = Date.now() + (maxWaitMs ?? AI.maxWaitMinutes * 60_000);
  for (let round = 1; round <= REWRITE.maxAttempts; round++) {
    const todo = st.filter((s) => !s.done);
    if (!todo.length) break;
    const current = (s) => prefilled.has(s.e.slug) && prefilled.get(s.e.slug).factsHash === s.e.factsHash;
    const pre = round === 1 ? todo.filter(current) : [];
    const send = round === 1 ? todo.filter((s) => !current(s)) : todo;
    const items = send.map((s) => ({ key: s.e.slug, request: rewriteRequest(s.facts, s.sourceText, s.problems) }));
    const res = await runRequests(ai, items, {
      label: `rewrite round ${round}`, log, now, minBatch, pollMs, maxWaitMs: Math.max(0, deadline - Date.now()),
      onSubmitted: (jobId) => onSubmitted?.(jobId, send.map((s) => ({ slug: s.e.slug, factsHash: s.e.factsHash }))),
    });
    if (res.timedOut) for (const s of send) Object.assign(s, { done: true, outcome: 'pending', jobId: res.jobId });
    const results = new Map(res.results);
    let usage = res.usage;
    for (const s of pre) {
      const r = prefilled.get(s.e.slug);
      results.set(s.e.slug, r);
      if (r.usage) usage = addUsage(usage, r.usage);
    }
    const counts = { accepted: 0, rejected: 0, failed: 0 };
    for (const s of [...pre, ...send]) {
      if (s.done) continue;
      s.attempts += 1;
      const r = results.get(s.e.slug);
      let out = null;
      if (r && !r.error) {
        try { out = parseModelJson(r.text); } catch (err) { s.lastError = `unusable output: ${err.message}`; }
      } else s.lastError = r?.error || 'no result';
      if (!out) { counts.failed += 1; continue; }
      s.lastOut = out;
      const problems = checkRewrite(out, s.sourceText, s.facts);
      if (!problems.length) {
        Object.assign(s, { done: true, outcome: 'ai', result: out });
        counts.accepted += 1;
      } else {
        s.problems = problems;
        counts.rejected += 1;
      }
    }
    if (res.mode !== 'none' || pre.length) {
      rounds.push({ ...roundSummary(round, { ...res, usage, items: res.items + pre.length }, counts), ...(pre.length ? { collectedFromEarlierJob: pre.length } : {}) });
    }
    if (res.jobId && !res.timedOut) onCollected?.(res.jobId);
  }
  const outcomes = new Map();
  for (const s of st) {
    if (s.outcome === 'ai') {
      outcomes.set(s.e.slug, { ...s.result, descriptionStatus: 'ai', attempts: s.attempts, problems: [], longestRun: longestSharedRun(s.result.description, s.sourceText).words });
    } else if (s.outcome === 'pending') {
      outcomes.set(s.e.slug, { descriptionStatus: 'pending', jobId: s.jobId, attempts: s.attempts, problems: [] });
    } else if (s.lastOut) {
      // A draft came back and failed the checks twice: human review.
      outcomes.set(s.e.slug, { descriptionStatus: 'review', rejected: s.lastOut, attempts: s.attempts, problems: s.problems });
    } else {
      // Nothing usable came back (outage, rate limit, bad key or model):
      // not a review case. The caller keeps a flagged placeholder and the
      // event is tried again on the next run.
      outcomes.set(s.e.slug, { descriptionStatus: 'error', attempts: s.attempts, problems: [s.lastError || 'AI call failed'] });
    }
  }
  return { outcomes, rounds };
}

// Batch jobs an earlier run stopped waiting for. Finished jobs are collected:
// each result keeps the facts hash it was written for, and rewriteMany uses
// it only if the event's facts are still the same. Jobs still running keep
// their events out of this run so nothing is paid for twice.
// Nothing is removed from data/ai-pending.json here: the caller forgets the
// collected jobs (forgetPendingJobs) only after the store is saved, so a
// crash in between never loses paid results.
export async function collectPendingRewrites(ai, { log = () => {}, file } = {}) {
  const pending = loadPending(file);
  const prefilled = new Map();
  const busy = new Set();
  const collected = [];
  for (const job of pending.jobs) {
    if (job.kind !== 'rewrite') continue;
    let op;
    try { op = await ai.batchGet(job.jobId); } catch (err) {
      log(`rewrite: could not check earlier batch job ${job.jobId}: ${err.message}`);
      for (const it of job.items) busy.add(it.slug);
      continue;
    }
    const state = batchState(op);
    if (!op.done && !['SUCCEEDED', 'FAILED', 'CANCELLED', 'EXPIRED'].includes(state)) {
      for (const it of job.items) busy.add(it.slug);
      log(`rewrite: earlier batch job ${job.jobId} is still ${state}; its ${job.items.length} events wait for it`);
      continue;
    }
    let got = 0;
    if (state === 'SUCCEEDED') {
      const results = ai.batchResults(op);
      job.items.forEach((it, i) => {
        // Match by our key; fall back to position only for unkeyed results.
        const r = results.find((x) => x.key === it.slug) ?? (results[i] && results[i].key == null ? results[i] : null);
        if (!r) return;
        prefilled.set(it.slug, {
          ...(r.error ? { error: `item failed: ${r.error.message || r.error.code}` } : { ...responseText(r.response), usage: usageOf(r.response) }),
          factsHash: it.factsHash,
        });
        got += 1;
      });
    }
    collected.push({ jobId: job.jobId, state, items: job.items.length, results: got });
    log(`rewrite: collected earlier batch job ${job.jobId} (${state}) with ${got} results`);
  }
  return { prefilled, busy, collected, collectedJobIds: collected.map((c) => c.jobId) };
}

export function rememberPendingJob(kind, jobId, items, now, file) {
  const pending = loadPending(file);
  pending.jobs.push({ kind, jobId, submittedAt: now.toISOString(), items });
  savePending(pending, file);
}

export function forgetPendingJobs(jobIds, file) {
  if (!jobIds.length) return;
  const pending = loadPending(file);
  pending.jobs = pending.jobs.filter((j) => !jobIds.includes(j.jobId));
  savePending(pending, file);
}

// Write one outcome onto its event. Returns the outcome kind.
export function applyRewriteOutcome(e, r, now) {
  if (!r || r.descriptionStatus === 'pending') {
    // Waiting on a batch job: the page shows a flagged placeholder built from
    // the current facts (never an old description written for older facts,
    // and never an empty page), and the next run collects the job.
    Object.assign(e, placeholderFor(e), { descriptionStatus: 'placeholder' });
    delete e.reviewInfo;
    return 'pending';
  }
  if (r.descriptionStatus === 'ai') {
    Object.assign(e, { description: r.description, summary: r.summary, descriptionStatus: 'ai', rewrittenAt: now.toISOString() });
    delete e.reviewInfo;
    delete e.lastAiError;
    return 'ai';
  }
  if (r.descriptionStatus === 'error') {
    // API trouble, not a bad draft: publish a flagged placeholder and retry
    // next run (placeholders are always queued for rewriting).
    Object.assign(e, placeholderFor(e), { descriptionStatus: 'placeholder', lastAiError: redact(r.problems[0] || 'AI call failed') });
    return 'error';
  }
  // Flagged for review. A never-published event stays unpublished; a page
  // that is already live keeps a flagged placeholder meanwhile.
  Object.assign(e, placeholderFor(e), { descriptionStatus: 'review' });
  e.reviewInfo = {
    slug: e.slug, title: e.title, factsHash: e.factsHash, attempts: r.attempts,
    problems: r.problems.map((p) => redact(p)), rejectedDraft: r.rejected || null, flaggedAt: now.toISOString(),
  };
  return 'review';
}
