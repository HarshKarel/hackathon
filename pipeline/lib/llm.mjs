// AI client for the rewrite engine. Uses the Anthropic Messages API through
// the official SDK. The key comes only from LLM_API_KEY and the model only
// from LLM_MODEL; neither is hardcoded and the key is never logged.
import Anthropic from '@anthropic-ai/sdk';

export function llmStatus(env = process.env) {
  if (!env.LLM_API_KEY) return { configured: false, reason: 'LLM_API_KEY is not set' };
  if (!env.LLM_MODEL) return { configured: false, reason: 'LLM_MODEL is not set' };
  return { configured: true, model: env.LLM_MODEL };
}

// Remove the key from any text before it is printed or stored.
export function redact(text, env = process.env) {
  let s = String(text ?? '');
  if (env.LLM_API_KEY) s = s.split(env.LLM_API_KEY).join('[redacted]');
  return s.replace(/sk-[A-Za-z0-9_-]{10,}/g, '[redacted]');
}

export function createLlm(env = process.env) {
  const status = llmStatus(env);
  if (!status.configured) return null;
  const client = new Anthropic({ apiKey: env.LLM_API_KEY, maxRetries: 3, timeout: 120_000 });
  const stats = { calls: 0, failures: 0, inputTokens: 0, outputTokens: 0 };
  return {
    model: status.model,
    stats,
    async complete({ system, user }) {
      stats.calls += 1;
      try {
        const res = await client.messages.create({
          model: status.model,
          max_tokens: 4000,
          system,
          messages: [{ role: 'user', content: user }],
        });
        stats.inputTokens += res.usage?.input_tokens || 0;
        stats.outputTokens += res.usage?.output_tokens || 0;
        if (res.stop_reason === 'refusal') throw new Error('model declined the request');
        if (res.stop_reason === 'max_tokens') throw new Error('response cut off at max_tokens');
        return res.content.filter((b) => b.type === 'text').map((b) => b.text).join('');
      } catch (err) {
        stats.failures += 1;
        let msg;
        if (err instanceof Anthropic.NotFoundError) msg = `model "${status.model}" not found (check LLM_MODEL)`;
        else if (err instanceof Anthropic.AuthenticationError) msg = 'authentication failed (check LLM_API_KEY)';
        else if (err instanceof Anthropic.RateLimitError) msg = 'rate limited after retries';
        else if (err instanceof Anthropic.APIError) msg = `API error ${err.status ?? ''}: ${err.message}`;
        else msg = err.message;
        throw new Error(redact(msg, env));
      }
    },
  };
}
