// Polite HTTP client used by every adapter.
// - identifies itself with a bot user agent
// - checks robots.txt before every request and refuses disallowed paths
// - spaces requests to the same host (one at a time, minimum interval)
// - retries transient failures with backoff
// - optional on-disk cache (--use-cache) so development runs do not hit sources
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { HTTP, PATHS } from '../config.mjs';
import { parseRobots, isAllowed } from './robots.mjs';

export class RobotsDisallowedError extends Error {
  constructor(url) {
    super(`robots.txt disallows ${url}`);
    this.name = 'RobotsDisallowedError';
  }
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export function createHttp({ useCache = false, fetchImpl = globalThis.fetch } = {}) {
  const robotsByOrigin = new Map();
  const hostChains = new Map();
  const hostLast = new Map();
  const stats = { requests: 0, cacheHits: 0, robotsBlocked: 0 };

  // Serialise requests per host and keep the minimum gap between them.
  function schedule(host, task) {
    const prev = hostChains.get(host) || Promise.resolve();
    const next = prev.catch(() => {}).then(async () => {
      const wait = (hostLast.get(host) || 0) + HTTP.perHostIntervalMs - Date.now();
      if (wait > 0) await sleep(wait);
      try {
        return await task();
      } finally {
        hostLast.set(host, Date.now());
      }
    });
    hostChains.set(host, next);
    return next;
  }

  async function rawFetch(url, init = {}) {
    stats.requests += 1;
    return fetchImpl(url, {
      redirect: 'follow',
      ...init,
      headers: { 'user-agent': HTTP.userAgent, accept: '*/*', ...(init.headers || {}) },
      signal: AbortSignal.timeout(HTTP.timeoutMs),
    });
  }

  async function robotsFor(origin) {
    if (robotsByOrigin.has(origin)) return robotsByOrigin.get(origin);
    const p = (async () => {
      const cacheFile = cachePath('GET', `${origin}/robots.txt`, '');
      if (useCache && fs.existsSync(cacheFile)) {
        const c = JSON.parse(fs.readFileSync(cacheFile, 'utf8'));
        return c.status >= 400 && c.status < 500 ? [] : parseRobots(c.body);
      }
      const host = new URL(origin).host;
      try {
        const res = await schedule(host, () => rawFetch(`${origin}/robots.txt`));
        const body = await res.text();
        writeCache(cacheFile, { status: res.status, body });
        if (res.status >= 400 && res.status < 500) return []; // no robots.txt: allowed
        if (res.status >= 500) return parseRobots('User-agent: *\nDisallow: /');
        return parseRobots(body);
      } catch {
        // Could not read robots.txt: be conservative and do not crawl.
        return parseRobots('User-agent: *\nDisallow: /');
      }
    })();
    robotsByOrigin.set(origin, p);
    return p;
  }

  function cachePath(method, url, body) {
    const key = crypto.createHash('sha1').update(`${method} ${url} ${body || ''}`).digest('hex');
    return path.join(PATHS.httpCache, `${key}.json`);
  }

  function writeCache(file, data) {
    try {
      fs.mkdirSync(path.dirname(file), { recursive: true });
      fs.writeFileSync(file, JSON.stringify(data));
    } catch {
      /* cache is best effort */
    }
  }

  async function request(url, { method = 'GET', body = null, headers = {} } = {}) {
    const u = new URL(url);
    const groups = await robotsFor(u.origin);
    if (!isAllowed(groups, HTTP.robotsToken, u.pathname + u.search)) {
      stats.robotsBlocked += 1;
      throw new RobotsDisallowedError(url);
    }
    const file = cachePath(method, url, body);
    if (useCache && fs.existsSync(file)) {
      stats.cacheHits += 1;
      const c = JSON.parse(fs.readFileSync(file, 'utf8'));
      return { status: c.status, text: c.body, url: c.url || url };
    }
    let lastErr;
    for (let attempt = 0; attempt <= HTTP.retries; attempt++) {
      try {
        const res = await schedule(u.host, () => rawFetch(url, { method, body, headers }));
        const text = await res.text();
        if (res.status === 429 || res.status >= 500) {
          lastErr = new Error(`HTTP ${res.status} for ${url}`);
          await sleep(2000 * 2 ** attempt);
          continue;
        }
        if (res.status >= 400) throw Object.assign(new Error(`HTTP ${res.status} for ${url}`), { fatal: true });
        writeCache(file, { status: res.status, body: text, url: res.url });
        return { status: res.status, text, url: res.url };
      } catch (err) {
        if (err.fatal) throw err;
        lastErr = err;
        await sleep(2000 * 2 ** attempt);
      }
    }
    throw lastErr;
  }

  return {
    stats,
    async getText(url, opts) {
      return (await request(url, opts)).text;
    },
    async getJson(url, opts) {
      const text = (await request(url, { ...opts, headers: { accept: 'application/json', ...(opts?.headers || {}) } })).text;
      return JSON.parse(text);
    },
    async postJson(url, payload) {
      const text = (await request(url, {
        method: 'POST',
        body: JSON.stringify(payload),
        headers: { 'content-type': 'application/json', accept: 'application/json' },
      })).text;
      return JSON.parse(text);
    },
  };
}
