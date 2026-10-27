// Status comes from dates only: upcoming -> live -> ended.
import { toInstant } from './dates.mjs';

export function computeStatus(e, now = new Date()) {
  const start = toInstant(e.startDate, { tz: e.timezone });
  const end = toInstant(e.endDate || e.startDate, { endOfDay: true, tz: e.timezone });
  if (start && now < start) return 'upcoming';
  if (end && now > end) return 'ended';
  return 'live';
}

// Is registration still possible, as far as the stated deadline says?
export function deadlineState(e, now = new Date()) {
  if (!e.registrationDeadline) return 'unstated';
  const d = toInstant(e.registrationDeadline, { endOfDay: true, tz: e.timezone });
  return now > d ? 'passed' : 'open';
}
