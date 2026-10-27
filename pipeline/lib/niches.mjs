// Tag each event with 1 to 3 niches from the fixed list in config.NICHES.
// Signals and weights:
//   platform default (e.g. ETHGlobal -> Web3)  4
//   source themes / tags                       3
//   title                                      2
//   source description text (never published)  1
// Text-only matches need a score of 2 or more. If nothing qualifies the
// event is tagged "Open".
import { NICHES } from '../config.mjs';

const RULES = {
  'AI and ML': [/\bai\b/, /\ba\.i\.?\b/, /artificial intelligence/, /machine learning/, /\bml\b/, /\bllms?\b/, /gen ?ai\b/, /generative/, /\bagents?\b/, /agentic/, /deep learning/, /neural/, /\bnlp\b/, /computer vision/, /\bgpt/, /\bopenai\b/, /\bgemini\b/, /\brag\b/],
  Web3: [/web ?3/, /blockchain/, /\bcrypto/, /ethereum/, /\beth\b/, /\bsolana\b/, /\bdefi\b/, /\bnfts?\b/, /\bpolygon\b/, /smart contracts?/, /\bdaos?\b/, /on-?chain/, /bitcoin/, /\bzk\b/, /zero.knowledge/, /starknet/, /\bsui\b/, /\baptos\b/, /\bstellar\b/, /\bcardano\b/, /\bdapps?\b/],
  Fintech: [/fintech/, /\bfinanc/, /banking/, /\bbank\b/, /payments?\b/, /\btrading\b/, /insurtech/, /\binsurance\b/, /\bquant/, /wealth/],
  Health: [/health/, /medic/, /medtech/, /biotech/, /wellness/, /clinical/, /hospital/, /pharma/, /\bbio\b/, /patient/],
  Climate: [/climate/, /sustainab/, /clean ?tech/, /\bgreen\b/, /renewable/, /\benergy\b/, /environment/, /carbon/, /net.zero/, /\bearth\b/],
  Design: [/\bdesign/, /\bui ?\/ ?ux\b/, /\bux\b/, /\bfigma\b/, /creative/, /\bart\b/, /music/],
  'Data Science': [/data science/, /\bdata\b/, /analytics/, /big data/, /visuali[sz]ation/, /databases?/, /datathon/],
  Hardware: [/hardware/, /\biot\b/, /internet of things/, /robotics\b/, /\brobots?\b/, /embedded/, /arduino/, /raspberry/, /electronics/, /\bmakers?\b/, /\bdrones?\b/, /\bfpga\b/],
  Gaming: [/\bgames?\b/, /gaming/, /game ?dev/, /game ?jam/, /esports/, /\bunity\b/, /unreal/],
  'Social Impact': [/social good/, /social impact/, /non-?profit/, /\bngo\b/, /education/, /edtech/, /accessib/, /civic/, /\bsdgs?\b/, /humanitarian/, /inclusi/, /government/, /community/, /\bdiversity\b/, /women in tech/],
  Student: [/\bstudents?\b/, /universit/, /college/, /high ?school/, /\bteens?\b/, /campus/, /undergrad/],
  Enterprise: [/enterprise/, /\bb2b\b/, /\bsaas\b/, /devops/, /\bcloud\b/, /productivity/, /low.?code/, /no.?code/, /cyber ?security/, /\bsecurity\b/],
  Open: [/open.ended/, /open innovation/, /any track/, /open theme/, /general/],
};

// Devpost theme names that do not match the keywords cleanly.
const THEME_MAP = {
  'machine learning/ai': 'AI and ML',
  'robotic process automation': 'Enterprise',
  'beginner friendly': null,
  'social good': 'Social Impact',
  'open ended': 'Open',
  'ar/vr': 'Gaming',
  'iot': 'Hardware',
  'e-commerce/retail': 'Enterprise',
  'communication': null,
  'lifehacks': null,
  'web': null,
  'mobile': null,
  'quantum': 'Hardware',
};

function score(text, weight, scores) {
  const t = String(text || '').toLowerCase();
  if (!t) return;
  for (const [niche, patterns] of Object.entries(RULES)) {
    let hits = 0;
    for (const p of patterns) if (p.test(t)) hits += 1;
    if (hits) scores[niche] = (scores[niche] || 0) + weight * Math.min(hits, 2);
  }
}

export function tagNiches({ title = '', themes = [], sourceText = '', platformDefaults = [] }) {
  const scores = {};
  for (const n of platformDefaults) if (NICHES.includes(n)) scores[n] = (scores[n] || 0) + 4;
  for (const theme of themes) {
    const k = String(theme).toLowerCase().trim();
    if (k in THEME_MAP) {
      if (THEME_MAP[k]) scores[THEME_MAP[k]] = (scores[THEME_MAP[k]] || 0) + 3;
      continue;
    }
    const before = { ...scores };
    score(k, 3, scores);
    // A theme counts once even if several patterns match it.
    for (const n of Object.keys(scores)) if ((scores[n] || 0) - (before[n] || 0) > 3) scores[n] = (before[n] || 0) + 3;
  }
  score(title, 2, scores);
  score(sourceText, 1, scores);
  const ranked = Object.entries(scores)
    .filter(([, s]) => s >= 2)
    .sort((a, b) => b[1] - a[1] || NICHES.indexOf(a[0]) - NICHES.indexOf(b[0]));
  const picked = ranked.slice(0, 3).map(([n]) => n);
  return picked.length ? picked : ['Open'];
}

export function nicheSlug(n) {
  return String(n).toLowerCase().replace(/ and /g, '-').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}
