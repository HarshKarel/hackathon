// Eligibility is kept twice: the text exactly as the source states it, and a
// filter value. Filter values:
//   students       limited to students (school or university)
//   professionals  limited to working professionals or employees
//   open           anyone may join (age or country limits allowed)
//   mixed          both students and professionals named, or another limit
//                  such as invite only or one group of people
// null means the source states nothing about eligibility.

const STUDENT = /\bstudents?\b|universit|college|undergrad|high ?school|enrolled|\bteens?\b|ages? 13.{0,4}18|school/i;
const PRO = /professional|employees?\b|working (developers|engineers)|\bcompany staff\b|\bstaff\b|startups?|founders?|industry/i;
// "Anyone may join" wording, as opposed to age or country limits, which do
// not change who the event is for.
const OPEN_ROLE = /anyone|everyone|open to all|all participants|no restrictions|all skill levels|open to everyone/i;
const AGE_OR_GEO = /all countries|countries|territories|legal age|age of majority|\b1[3-8]\+|\bover 1[3-8]\b|above .{0,20}age|\bages? \d|worldwide|global/i;
const OTHER_LIMIT = /invite.only|by invitation|women|female|non-binary|employees of|members of|residents of .{0,40} only/i;

// Clauses that exclude a group ("Companies/professional organizations
// excluded from participation") say who may NOT join, so they are skipped
// when deciding who the event is for.
const EXCLUSION = /exclud|not eligible|ineligible|cannot (participate|enter|join)|may not (participate|enter|join)|not allowed/i;

export function normaliseEligibility(text, flags = {}) {
  if (flags.inviteOnly) return 'mixed';
  if (!String(text || '').trim()) return flags.defaultValue ?? null;
  const t = String(text)
    .split(/[;\n]+/)
    .filter((clause) => !EXCLUSION.test(clause))
    .join('; ');
  const s = STUDENT.test(t);
  const p = PRO.test(t);
  if (s && p) return 'mixed';
  if (OTHER_LIMIT.test(t)) return 'mixed';
  if (s) return OPEN_ROLE.test(t) ? 'mixed' : 'students';
  if (p) return OPEN_ROLE.test(t) ? 'mixed' : 'professionals';
  if (OPEN_ROLE.test(t) || AGE_OR_GEO.test(t)) return 'open';
  return 'mixed';
}

export const ELIGIBILITY_LABELS = {
  students: 'Students',
  professionals: 'Professionals',
  open: 'Open to all',
  mixed: 'Mixed or limited',
};
