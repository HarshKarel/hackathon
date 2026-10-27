// Suggested how-tos for an event page: 2 or 3 guides chosen by simple rules.
//
//   ended                         Reflect: after it ends, how judging works
//   live                          Prepare: demo, pitch
//   live, deadline within 7 days  Prepare: platform guide, demo, pitch
//   upcoming, deadline within 7 days
//     and listed on Devpost/Devfolio  Prepare: platform guide, team, plan
//     otherwise                       Prepare: team, plan, problem
//   upcoming, starts within 7 days    Prepare: plan, team, problem
//   upcoming, otherwise               Prepare: choose, problem, team
//
// The platform guide matches the platform you apply on (Devpost or Devfolio);
// other platforms have no step-by-step guide yet.
import { dateBound } from '../assets/js/format.js';

export const NEAR_DAYS = 7;
const DAY = 86_400_000;

export function platformGuideKey(e) {
  if (e.applyPlatform === 'devpost' || e.applyPlatform === 'devfolio') return e.applyPlatform;
  const s = (e.sources || []).find((x) => x.platform === 'devpost' || x.platform === 'devfolio');
  return s ? s.platform : null;
}

export function suggestGuideKeys(e, now = new Date()) {
  if (e.status === 'ended') return { block: 'Reflect', keys: ['after', 'judging'] };
  const dl = e.registrationDeadline ? dateBound(e.registrationDeadline, { end: true, tz: e.timezone }) : null;
  const nearDeadline = Boolean(dl && dl >= now && dl - now <= NEAR_DAYS * DAY);
  const platform = platformGuideKey(e);
  if (e.status === 'live') {
    return { block: 'Prepare', keys: nearDeadline && platform ? [platform, 'demo', 'pitch'] : ['demo', 'pitch'] };
  }
  const start = dateBound(e.startDate, { tz: e.timezone });
  const startsSoon = Boolean(start && start - now <= NEAR_DAYS * DAY);
  if (nearDeadline && platform) return { block: 'Prepare', keys: [platform, 'team', 'plan'] };
  if (nearDeadline) return { block: 'Prepare', keys: ['team', 'plan', 'problem'] };
  if (startsSoon) return { block: 'Prepare', keys: ['plan', 'team', 'problem'] };
  return { block: 'Prepare', keys: ['choose', 'problem', 'team'] };
}
