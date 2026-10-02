/**
 * Phase 32 C4.1 — the maths of a recurring playbook: which period a moment
 * is in, when a period's run is due, and the words. Pure, so the window, the
 * phone's words and the backend agree.
 *
 * A period runs from its due moment to the next period's, in the rule's
 * time zone: a weekly rule due Monday 09:00 is "due since Monday" until the
 * next Monday 09:00. Weekly periods are ISO weeks ("2026-W40").
 */
import type { RecurEvery, RecurrenceRule } from '../types/recurring';

const DAY = 86_400_000;
const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
const WEEKDAY_NAMES = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** A calendar date, as numbers (month 1–12). */
export interface CalDate { y: number; m: number; d: number }

/** A period: its kind and the date that anchors it (the day; the ISO week's Monday; the month's 1st). */
export interface Period { every: RecurEvery; anchor: CalDate }

const fmtCache = new Map<string, Intl.DateTimeFormat>();
function fmt(timeZone: string): Intl.DateTimeFormat {
  let f = fmtCache.get(timeZone);
  if (!f) {
    f = new Intl.DateTimeFormat('en-US', {
      timeZone, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit',
    });
    fmtCache.set(timeZone, f);
  }
  return f;
}

/** Whether the runtime knows this IANA zone. */
export function isTimeZone(tz: string): boolean {
  try { fmt(tz); return true; } catch { return false; }
}

/** The wall clock in `timeZone` at `ms`. */
export function wallClock(timeZone: string, ms: number): CalDate & { H: number; M: number } {
  const parts: Record<string, number> = {};
  for (const p of fmt(timeZone).formatToParts(new Date(ms))) if (p.type !== 'literal') parts[p.type] = Number(p.value);
  return { y: parts.year, m: parts.month, d: parts.day, H: parts.hour === 24 ? 0 : parts.hour, M: parts.minute };
}

/** The moment the wall clock in `timeZone` reads this date and time (the earlier one in an autumn repeat). */
export function zonedMoment(timeZone: string, date: CalDate, H: number, M: number): number {
  const want = Date.UTC(date.y, date.m - 1, date.d, H, M);
  let guess = want;
  for (let i = 0; i < 3; i++) {
    const w = wallClock(timeZone, guess);
    const diff = want - Date.UTC(w.y, w.m - 1, w.d, w.H, w.M);
    if (diff === 0) break;
    guess += diff;
  }
  return guess;
}

function utcOf(d: CalDate): number { return Date.UTC(d.y, d.m - 1, d.d); }
function dateOf(ms: number): CalDate { const t = new Date(ms); return { y: t.getUTCFullYear(), m: t.getUTCMonth() + 1, d: t.getUTCDate() }; }
function addDays(d: CalDate, n: number): CalDate { return dateOf(utcOf(d) + n * DAY); }
/** 1 Monday … 7 Sunday. */
function isoWeekday(d: CalDate): number { return ((new Date(utcOf(d)).getUTCDay() + 6) % 7) + 1; }

/** The ISO year and week of a date. */
export function isoWeek(d: CalDate): { year: number; week: number } {
  const thursday = addDays(d, 4 - isoWeekday(d));
  const jan1 = utcOf({ y: thursday.y, m: 1, d: 1 });
  return { year: thursday.y, week: Math.floor((utcOf(thursday) - jan1) / DAY / 7) + 1 };
}

/** The period a date falls in. */
export function periodOf(every: RecurEvery, d: CalDate): Period {
  if (every === 'day') return { every, anchor: d };
  if (every === 'week') return { every, anchor: addDays(d, 1 - isoWeekday(d)) };
  return { every, anchor: { y: d.y, m: d.m, d: 1 } };
}

export function nextPeriod(p: Period): Period {
  if (p.every === 'day') return { every: 'day', anchor: addDays(p.anchor, 1) };
  if (p.every === 'week') return { every: 'week', anchor: addDays(p.anchor, 7) };
  return { every: 'month', anchor: p.anchor.m === 12 ? { y: p.anchor.y + 1, m: 1, d: 1 } : { y: p.anchor.y, m: p.anchor.m + 1, d: 1 } };
}

export function previousPeriod(p: Period): Period {
  if (p.every === 'day') return { every: 'day', anchor: addDays(p.anchor, -1) };
  if (p.every === 'week') return { every: 'week', anchor: addDays(p.anchor, -7) };
  return { every: 'month', anchor: p.anchor.m === 1 ? { y: p.anchor.y - 1, m: 12, d: 1 } : { y: p.anchor.y, m: p.anchor.m - 1, d: 1 } };
}

const pad = (n: number, w = 2) => String(n).padStart(w, '0');

/** "2026-10-01", "2026-W40", "2026-10". */
export function periodId(p: Period): string {
  if (p.every === 'day') return `${p.anchor.y}-${pad(p.anchor.m)}-${pad(p.anchor.d)}`;
  if (p.every === 'week') { const w = isoWeek(p.anchor); return `${w.year}-W${pad(w.week)}`; }
  return `${p.anchor.y}-${pad(p.anchor.m)}`;
}

/** "1 Oct", "W40", "Oct 2026". */
export function periodLabel(p: Period): string {
  if (p.every === 'day') return `${p.anchor.d} ${MONTHS[p.anchor.m - 1]}`;
  if (p.every === 'week') return `W${pad(isoWeek(p.anchor).week)}`;
  return `${MONTHS[p.anchor.m - 1]} ${p.anchor.y}`;
}

function hhmm(at: string): { H: number; M: number } {
  const m = /^(\d{2}):(\d{2})$/.exec(at);
  return m ? { H: Number(m[1]), M: Number(m[2]) } : { H: 9, M: 0 };
}

/** When a period's run is due: its day (the rule's weekday in the week, the rule's day in the month) at the rule's time. */
export function dueAt(rule: Pick<RecurrenceRule, 'every' | 'on' | 'at' | 'timeZone'>, p: Period): number {
  const { H, M } = hhmm(rule.at);
  const day = p.every === 'day' ? p.anchor
    : p.every === 'week' ? addDays(p.anchor, Math.min(7, Math.max(1, rule.on)) - 1)
      : { ...p.anchor, d: Math.min(28, Math.max(1, rule.on)) };
  return zonedMoment(rule.timeZone, day, H, M);
}

/** The latest period whose run is due at or before `now`: the one that can be started. */
export function currentPeriod(rule: Pick<RecurrenceRule, 'every' | 'on' | 'at' | 'timeZone'>, now: number): Period {
  const w = wallClock(rule.timeZone, now);
  let p = periodOf(rule.every, { y: w.y, m: w.m, d: w.d });
  if (dueAt(rule, p) > now) p = previousPeriod(p);
  return p;
}

/** "every Mon 09:00", "every day 09:00", "every month on the 1st, 09:00". */
export function scheduleWords(rule: Pick<RecurrenceRule, 'every' | 'on' | 'at'>): string {
  if (rule.every === 'day') return `every day ${rule.at}`;
  if (rule.every === 'week') return `every ${WEEKDAYS[Math.min(7, Math.max(1, rule.on)) - 1]} ${rule.at}`;
  const n = rule.on;
  const suffix = n % 10 === 1 && n !== 11 ? 'st' : n % 10 === 2 && n !== 12 ? 'nd' : n % 10 === 3 && n !== 13 ? 'rd' : 'th';
  return `every month on the ${n}${suffix}, ${rule.at}`;
}

/** "every Mon 09:00 · skill: security-review" */
export function seriesWords(rule: Pick<RecurrenceRule, 'every' | 'on' | 'at' | 'skills'>): string {
  const skills = rule.skills.map((s) => s.name);
  return [scheduleWords(rule), skills.length ? `${skills.length === 1 ? 'skill' : 'skills'}: ${skills.join(', ')}` : null].filter(Boolean).join(' · ');
}

/** "since Monday 09:00", "since 09:00", "since 1 Oct 09:00": when the current run became due, in the rule's zone. */
export function sinceWords(rule: Pick<RecurrenceRule, 'every' | 'timeZone'>, due: number): string {
  const w = wallClock(rule.timeZone, due);
  const time = `${pad(w.H)}:${pad(w.M)}`;
  if (rule.every === 'day') return `since ${time}`;
  if (rule.every === 'week') return `since ${WEEKDAY_NAMES[isoWeekday(w) - 1]} ${time}`;
  return `since ${w.d} ${MONTHS[w.m - 1]} ${time}`;
}

/** "Mon 6 Oct 09:00", in the rule's zone. */
export function momentWords(timeZone: string, ms: number): string {
  const w = wallClock(timeZone, ms);
  return `${WEEKDAYS[isoWeekday(w) - 1]} ${w.d} ${MONTHS[w.m - 1]} ${pad(w.H)}:${pad(w.M)}`;
}
