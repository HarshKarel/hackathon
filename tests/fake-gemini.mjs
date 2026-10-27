// A stand-in for the Gemini REST API (generateContent, batchGenerateContent,
// batches/{id}) for tests. It checks the key header and records every call so
// tests can assert on the exact request shapes.
//
//   respond(request, key) -> model text (string), or { error }, or { finishReason, text }
import { createGemini } from '../pipeline/lib/gemini.mjs';

export const TEST_ENV = { LLM_API_KEY: 'AIzaTestKeyThatIsLongEnough000000', LLM_MODEL: 'gemini-3.8-flash' };
export const USAGE = { promptTokenCount: 1000, candidatesTokenCount: 200, thoughtsTokenCount: 100, totalTokenCount: 1300 };

function makeResponse(out) {
  if (out && typeof out === 'object' && out.finishReason) {
    return { candidates: [{ content: { parts: [{ text: out.text || '' }] }, finishReason: out.finishReason }], usageMetadata: USAGE };
  }
  return {
    candidates: [{ content: { role: 'model', parts: [{ text: 'thinking...', thought: true }, { text: String(out) }] }, finishReason: 'STOP' }],
    usageMetadata: USAGE,
  };
}

const json = (status, body) => ({ ok: status >= 200 && status < 300, status, text: async () => JSON.stringify(body) });

export function fakeGemini({ respond, pollsBeforeDone = 1, finalState = 'BATCH_STATE_SUCCEEDED', failStandardTimes = 0, env = TEST_ENV } = {}) {
  const calls = [];
  const jobs = new Map();
  let n = 0;
  let standardFailures = 0;
  async function fetchImpl(url, opts = {}) {
    const body = opts.body ? JSON.parse(opts.body) : null;
    calls.push({ url, method: opts.method, headers: opts.headers, body });
    if (opts.headers?.['x-goog-api-key'] !== env.LLM_API_KEY) return json(403, { error: { code: 403, message: 'API key not valid' } });
    const path = new URL(url).pathname;
    let m;
    if ((m = path.match(/^\/v1beta\/models\/([^/:]+):generateContent$/))) {
      if (standardFailures < failStandardTimes) { standardFailures += 1; return json(429, { error: { code: 429, message: 'Resource exhausted' } }); }
      const out = respond(body, null);
      if (out && out.error) return json(500, { error: { code: 500, message: out.error } });
      return json(200, makeResponse(out));
    }
    if ((m = path.match(/^\/v1beta\/models\/([^/:]+):batchGenerateContent$/))) {
      const name = `batches/fake${++n}`;
      jobs.set(name, { model: m[1], body, polls: 0 });
      return json(200, { name, metadata: { state: 'BATCH_STATE_PENDING', displayName: body.batch.display_name } });
    }
    if ((m = path.match(/^\/v1beta\/(batches\/[^/]+)$/))) {
      const job = jobs.get(m[1]);
      if (!job) return json(404, { error: { code: 404, message: 'not found' } });
      job.polls += 1;
      if (job.polls <= pollsBeforeDone) return json(200, { name: m[1], metadata: { state: 'BATCH_STATE_RUNNING' }, done: false });
      if (finalState !== 'BATCH_STATE_SUCCEEDED' && finalState !== 'JOB_STATE_SUCCEEDED') {
        return json(200, { name: m[1], metadata: { state: finalState }, done: true, error: { code: 13, message: 'job failed' } });
      }
      const reqs = job.body.batch.input_config.requests.requests;
      return json(200, {
        name: m[1],
        metadata: { state: finalState, batchStats: { requestCount: String(reqs.length) } },
        done: true,
        response: {
          inlinedResponses: {
            inlinedResponses: reqs.map((r) => {
              const out = respond(r.request, r.metadata.key);
              if (out && out.error) return { metadata: r.metadata, error: { code: 3, message: out.error } };
              return { metadata: r.metadata, response: makeResponse(out) };
            }),
          },
        },
      });
    }
    return json(404, { error: { code: 404, message: `unknown path ${path}` } });
  }
  const ai = createGemini(env, { fetchImpl, sleep: async () => {} });
  return { ai, calls, jobs, fetchImpl };
}

// The user prompt text of a Gemini request.
export const promptOf = (request) => request.contents[0].parts[0].text;
