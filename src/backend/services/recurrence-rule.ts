/**
 * Phase 32 C4.1 — a recurrence rule as the committed config, or a person
 * setting one, gives it. The config is anyone's text, so every field is
 * checked and a rule that does not read as one is refused with why.
 */
import type { RecurrenceRule } from '../../shared/types/recurring';
import { isTimeZone } from '../../shared/lib/recurrence';
import { normaliseSkills } from './skill-model';

const ID = /^[a-z0-9][a-z0-9-]{0,62}$/;
const PLAYBOOK = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;
const AT = /^([01]\d|2[0-3]):[0-5]\d$/;

export function parseRecurrenceRule(raw: unknown): { rule: RecurrenceRule | null; problems: string[] } {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return { rule: null, problems: ['a rule must be an object'] };
  const r = raw as Record<string, unknown>;
  const problems: string[] = [];
  const str = (k: string) => (typeof r[k] === 'string' ? (r[k] as string).trim() : '');

  const id = str('id');
  if (!ID.test(id)) problems.push('id must be lower-case letters, digits and dashes, at most 63');
  const playbook = str('playbook');
  if (!PLAYBOOK.test(playbook)) problems.push('playbook must name a playbook (a plan template id)');
  const title = str('title');
  if (!title || title.length > 120) problems.push('title must be 1 to 120 characters');
  const every = r.every === 'day' || r.every === 'week' || r.every === 'month' ? r.every : null;
  if (!every) problems.push('every must be day, week or month');
  let on = typeof r.on === 'number' && Number.isInteger(r.on) ? r.on : every === 'day' ? 1 : NaN;
  if (every === 'week' && !(on >= 1 && on <= 7)) problems.push('on must be the weekday, 1 (Monday) to 7 (Sunday)');
  if (every === 'month' && !(on >= 1 && on <= 28)) problems.push('on must be the day of the month, 1 to 28');
  if (every === 'day') on = 1;
  const at = str('at');
  if (!AT.test(at)) problems.push('at must be a time, HH:MM');
  const timeZone = str('timeZone');
  if (!timeZone || !isTimeZone(timeZone)) problems.push('timeZone must be an IANA time zone, e.g. Europe/London');
  const { skills, problems: skillProblems } = normaliseSkills(r.skills);
  problems.push(...skillProblems);
  const since = str('since');
  if (!since || Number.isNaN(Date.parse(since))) problems.push('since must be an ISO date');
  const by = str('by').slice(0, 200);

  if (problems.length > 0 || !every) return { rule: null, problems };
  return {
    rule: { id, playbook, title, every, on, at, timeZone, carryOver: r.carryOver === true, skills, since: new Date(since).toISOString(), by },
    problems: [],
  };
}
