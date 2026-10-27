// Gemini API client (Google AI Studio, generativelanguage.googleapis.com),
// plain REST over fetch. Used by the rewrite engine and the idea generator.
//
// The key comes only from LLM_API_KEY and the model only from LLM_MODEL;
// neither is hardcoded, and the key is never logged or stored.
//
//   generate(request)            one standard generateContent call, with retries
//   batchCreate(items, name)     one Batch API job with inline requests; returns its name
//   batchWait(name, opts)        poll until the job finishes (or the wait runs out)
//   batchResults(op)             [{ key, response | error }] from a finished job
import { AI } from '../config.mjs';

const BASE = 'https://generativelanguage.googleapis.com/v1beta';

export function aiStatus(env = process.env) {
  if (!env.LLM_API_KEY) return { configured: false, reason: 'LLM_API_KEY is not set' };
  if (!env.LLM_MODEL) return { configured: false, reason: 'LLM_MODEL is not set' };
  return { configured: true, model: env.LLM_MODEL.replace(/^models\//, '') };
}

// Remove the key from any text before it is printed or stored. Google API
// keys start with "AIza"; any such string is removed too.
export function redact(text, env = process.env) {
  let s = String(text ?? '');
  if (env.LLM_API_KEY) s = s.split(env.LLM_API_KEY).join('[redacted]');
  return s.replace(/AIza[0-9A-Za-z_-]{20,}/g, '[redacted]');
}

// Batch states appear as BATCH_STATE_* in the API reference and JOB_STATE_*
// in some guide examples; compare on the suffix.
export function batchState(op) {
  return String(op?.metadata?.state || '').replace(/^(BATCH|JOB)_STATE_/, '') || 'UNSPECIFIED';
}
const TERMINAL = new Set(['SUCCEEDED', 'FAILED', 'CANCELLED', 'EXPIRED']);

// Text of a generateContent response, or an error when the model did not
// finish normally (safety block, cut off at the token limit, and so on).
export function responseText(res) {
  if (!res?.candidates?.length) {
    const why = res?.promptFeedback?.blockReason;
    return { error: why ? `request blocked (${why})` : 'no candidates in the response' };
  }
  const c = res.candidates[0];
  if (c.finishReason && c.finishReason !== 'STOP') return { error: `model stopped with finishReason ${c.finishReason}` };
  const text = (c.content?.parts || []).filter((p) => !p.thought && typeof p.text === 'string').map((p) => p.text).join('');
  if (!text.trim()) return { error: 'empty response text' };
  return { text };
}

export function usageOf(res) {
  const u = res?.usageMetadata || {};
  return { input: u.promptTokenCount || 0, output: u.candidatesTokenCount || 0, thoughts: u.thoughtsTokenCount || 0 };
}

export function addUsage(a, b) {
  return { input: a.input + b.input, output: a.output + b.output, thoughts: a.thoughts + b.thoughts };
}

export const ZERO_USAGE = Object.freeze({ input: 0, output: 0, thoughts: 0 });

// Estimated cost in USD at AI.pricePerMillion. Thinking tokens bill as output.
export function costUsd(u, price = AI.pricePerMillion) {
  return Math.round(((u.input * price.input + (u.output + u.thoughts) * price.output) / 1e6) * 1e6) / 1e6;
}

const RETRYABLE = new Set([408, 429, 500, 502, 503, 504]);

export function createGemini(env = process.env, { fetchImpl = globalThis.fetch, sleep = (ms) => new Promise((r) => setTimeout(r, ms)), retries = 4 } = {}) {
  const status = aiStatus(env);
  if (!status.configured) return null;
  const model = status.model;
  const stats = { standardCalls: 0, failures: 0, usage: { ...ZERO_USAGE }, batchJobs: [] };

  async function call(method, path, body) {
    let lastErr;
    for (let attempt = 0; attempt <= retries; attempt++) {
      let res;
      try {
        res = await fetchImpl(`${BASE}/${path}`, {
          method,
          headers: { 'x-goog-api-key': env.LLM_API_KEY, 'content-type': 'application/json' },
          body: body ? JSON.stringify(body) : undefined,
        });
      } catch (err) {
        lastErr = new Error(redact(`network error: ${err.message}`, env));
        if (attempt < retries) { await sleep(1000 * 2 ** attempt); continue; }
        throw lastErr;
      }
      const text = await res.text();
      let json = null;
      try { json = text ? JSON.parse(text) : {}; } catch { /* not JSON */ }
      if (res.ok) return json ?? {};
      const msg = json?.error?.message || text.slice(0, 300);
      let hint = '';
      if (res.status === 404) hint = ` (check LLM_MODEL: "${model}")`;
      if (res.status === 400 && /api key/i.test(msg)) hint = ' (check LLM_API_KEY)';
      if (res.status === 401 || res.status === 403) hint = ' (check LLM_API_KEY and that the project has access)';
      lastErr = Object.assign(new Error(redact(`Gemini API ${res.status}: ${msg}${hint}`, env)), { status: res.status });
      if (!RETRYABLE.has(res.status) || attempt === retries) throw lastErr;
      await sleep(Math.min(60_000, 2000 * 2 ** attempt) + Math.floor(Math.random() * 500));
    }
    throw lastErr;
  }

  return {
    model,
    stats,

    async generate(request) {
      stats.standardCalls += 1;
      try {
        const res = await call('POST', `models/${encodeURIComponent(model)}:generateContent`, request);
        stats.usage = addUsage(stats.usage, usageOf(res));
        return res;
      } catch (err) {
        stats.failures += 1;
        throw err;
      }
    },

    async batchCreate(items, displayName) {
      const body = {
        batch: {
          display_name: displayName,
          input_config: { requests: { requests: items.map((it) => ({ request: it.request, metadata: { key: it.key } })) } },
        },
      };
      const op = await call('POST', `models/${encodeURIComponent(model)}:batchGenerateContent`, body);
      const name = op?.name || op?.metadata?.name;
      if (!name) throw new Error('batch job created but no job name returned');
      stats.batchJobs.push(name);
      return name;
    },

    async batchGet(name) {
      return call('GET', name.replace(/^\/+/, ''));
    },

    // Poll until the job is finished. Returns { op, state, timedOut }.
    async batchWait(name, { pollMs = AI.pollSeconds * 1000, maxWaitMs = AI.maxWaitMinutes * 60_000, onPoll } = {}) {
      let waited = 0;
      for (;;) {
        const op = await this.batchGet(name);
        const state = batchState(op);
        onPoll?.(state, op);
        if (op.done || TERMINAL.has(state)) return { op, state: op.error && !TERMINAL.has(state) ? 'FAILED' : state, timedOut: false };
        if (waited + pollMs > maxWaitMs) return { op, state, timedOut: true };
        await sleep(pollMs);
        waited += pollMs;
      }
    },

    batchResults(op) {
      const r = op?.response;
      const arr = r?.inlinedResponses?.inlinedResponses ?? (Array.isArray(r?.inlinedResponses) ? r.inlinedResponses : []);
      return arr.map((x, i) => ({ key: x?.metadata?.key ?? null, index: i, response: x?.response || null, error: x?.error || null }));
    },
  };
}
