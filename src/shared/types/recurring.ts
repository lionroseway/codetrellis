/**
 * Phase 32 C4 — recurring playbooks (shared-work doc C-4).
 *
 * A recurrence is a rule on a playbook, kept in the committed
 * `.codetrellis/config.json` so the team sees it. Each run is a fresh plan
 * from the playbook, one per period, with an id derived from the rule and
 * the period so two starts (here, or on two machines) are one plan.
 */
import type { Skill } from './plan';

export type RecurEvery = 'day' | 'week' | 'month';

export interface RecurrenceRule {
  /** A slug, unique in the project: `weekly-security-review`. */
  id: string;
  /** The playbook (plan template) each run is made from. */
  playbook: string;
  /** "Weekly security review"; a run is "<title> — W40". */
  title: string;
  every: RecurEvery;
  /** Weekly: the ISO weekday, 1 Monday … 7 Sunday. Monthly: the day, 1–28. Daily: unused. */
  on: number;
  /** "09:00", in `timeZone`. */
  at: string;
  /** IANA, e.g. "Europe/London": the team's clock, not each device's. */
  timeZone: string;
  /** Carry the previous run's open tasks into the new one. */
  carryOver: boolean;
  /** Skills each run's tasks get (C1), beside what the playbook's tasks name. */
  skills: Skill[];
  /** When the rule was set (ISO): periods due before it are not counted as missed. */
  since: string;
  /** Who set it, from the transport. */
  by: string;
}

/** One period of a series, oldest first. */
export interface RecurringRun {
  /** "2026-W40", "2026-10-01", "2026-10". */
  period: string;
  /** "W40", "1 Oct", "Oct 2026". */
  label: string;
  /** When the period's run is due (ms). */
  dueAt: number;
  state: 'done' | 'in_progress' | 'missed' | 'due' | 'next';
  /** The run's plan, when it has one. */
  planUid: string | null;
  /** "W40 ◐ in progress", "W39 ✗ missed", "W41 next, Mon 6 Oct 09:00". */
  words: string;
}

export interface RecurringSeries {
  rule: RecurrenceRule;
  /** "every Mon 09:00 · skill: security-review" */
  words: string;
  /** The counted periods up to now (at most the last eight), then the next one. */
  runs: RecurringRun[];
  /** The current period, when its run is due and not started: "Weekly security review is due since Monday 09:00". */
  due: {
    period: string;
    label: string;
    since: number;
    words: string;
    /** The person chose "Not this time" on this device (C4.2a): not asked again; missed when the period ends. */
    dismissed: boolean;
  } | null;
  /**
   * On this device, the agent each run made here starts (C4.3b): off (null)
   * unless the person turned it on here. Never in the committed config.
   */
  agent: { agent: 'claude' | 'codex'; by: string; at: number } | null;
}

/** What a run knows about its series (kept where it was started; found by id elsewhere). */
export interface RecurrenceInfo {
  rule: string;
  period: string;
  label: string;
  /** The latest earlier run of the series, when there is one. */
  previous: string | null;
  /** Tasks carried from it, with the period they came from. */
  carried: Array<{ itemUid: string; from: string }>;
  /** Who started it here: a person, or the schedule (C4.2a), and when. */
  startedBy?: string;
  startedAt?: number;
}
