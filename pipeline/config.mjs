// Pipeline settings. Secrets never live here: the AI key and model come
// from the environment (LLM_API_KEY, LLM_MODEL) and are read in lib/llm.mjs.
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
export const ROOT = path.resolve(here, '..');

export const PATHS = {
  data: path.join(ROOT, 'data'),
  store: path.join(ROOT, 'data', 'events.json'),
  seed: path.join(ROOT, 'data', 'seed-events.json'),
  reviews: path.join(ROOT, 'data', 'reviews.json'),
  reviewQueue: path.join(ROOT, 'data', 'review-queue.json'),
  healthDir: path.join(ROOT, 'data', 'health'),
  healthRuns: path.join(ROOT, 'data', 'health', 'runs.jsonl'),
  healthLatest: path.join(ROOT, 'data', 'health', 'latest.json'),
  // Raw source text (listing descriptions) is kept out of git and off the
  // site. It is only used to check rewrites for copied sentences.
  cache: path.join(ROOT, '.cache'),
  httpCache: path.join(ROOT, '.cache', 'http'),
  sourceText: path.join(ROOT, '.cache', 'source-text.json'),
};

export const SITE = {
  name: 'hackathon.so',
  url: 'https://hackathon.so',
};

export const HTTP = {
  userAgent: 'Mozilla/5.0 (compatible; hackathon.so-bot/0.1; +https://hackathon.so/sources/)',
  robotsToken: 'hackathon.so-bot',
  timeoutMs: 30_000,
  retries: 2,
  // Minimum gap between two requests to the same host.
  perHostIntervalMs: 1_000,
};

// Ended events are only ingested on first sight if they ended within this
// window. Once an event is in the store it is never dropped.
export const ENDED_LOOKBACK_DAYS = 60;

// Devpost detail pages (exact deadline, eligibility, address) are fetched for
// open and upcoming events, and once for each newly seen ended event. Capped
// to keep a run polite (one request per second to devpost.com).
export const DEVPOST_DETAIL_LIMIT = 600;
export const DEVFOLIO_PRIZE_LIMIT = 100;

// Quality: five completeness checks worth 20 points each.
export const QUALITY_FLOOR = 60;

export const REWRITE = {
  minWords: 80,
  maxWords: 140,
  maxSummaryChars: 160,
  maxAttempts: 2, // first try plus one retry, then flag for review
};

export const NICHES = [
  'AI and ML', 'Web3', 'Fintech', 'Health', 'Climate', 'Design', 'Data Science',
  'Hardware', 'Gaming', 'Social Impact', 'Student', 'Enterprise', 'Open',
];

export const PLATFORMS = {
  devpost: { name: 'Devpost', home: 'https://devpost.com/hackathons', covers: 'Online and in-person hackathons hosted on Devpost, worldwide. We read open and upcoming events plus recently ended ones.' },
  devfolio: { name: 'Devfolio', home: 'https://devfolio.co/hackathons', covers: 'Hackathons run on Devfolio, with a strong base in India and the Web3 community. We read open, upcoming and recently ended events, plus stated prizes.' },
  mlh: { name: 'MLH', home: 'https://www.mlh.com/seasons', covers: 'Major League Hacking member events, mostly student hackathons in North America, Europe and Asia Pacific. We read the current and next season pages.' },
  hackerearth: { name: 'HackerEarth', home: 'https://www.hackerearth.com/challenges/hackathon/', covers: 'Online hackathons hosted on HackerEarth, often run by companies. Programming contests in the same feed are skipped.' },
  ethglobal: { name: 'ETHGlobal', home: 'https://ethglobal.com/events', covers: 'ETHGlobal hackathons, in person and online, focused on Ethereum. Meetups, summits and other non-hackathon events are skipped.' },
  hackclub: { name: 'Hack Club', home: 'https://hackathons.hackclub.com', covers: 'The Hack Club directory of high school hackathons around the world.' },
  seed: { name: 'hackathon.so curated', home: 'https://hackathon.so/sources/', covers: 'A hand-maintained list of well known events that do not publish a feed, such as NASA Space Apps and Smart India Hackathon.' },
};

// When two sources describe the same event, facts are taken from the first
// source in this order that states them.
export const SOURCE_PRIORITY = ['seed', 'devfolio', 'devpost', 'ethglobal', 'hackerearth', 'mlh', 'hackclub'];
