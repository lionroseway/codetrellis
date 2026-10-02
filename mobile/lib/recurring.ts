/**
 * Recurring playbooks, on the phone (Phase 32 C4.3a, over C4's `recurring.*`).
 *
 * The desktop keeps the rules (in the committed project config) and works out
 * each series: one mark per period, "W38 ✓ · W39 ✗ missed · W40 due", and the
 * next. The phone lists them in the desktop's words and starts the run due
 * now; starting it twice, here or on another machine, is one run. Setting a
 * rule stays in the app window. Mirrors `src/shared/types/recurring.ts`,
 * which the Expo project cannot import.
 */

import { rpc } from './rpc';

export type RunState = 'done' | 'in_progress' | 'missed' | 'due' | 'next';

export interface RecurringRun {
  period: string;
  label: string;
  dueAt: number;
  state: RunState;
  planUid: string | null;
  words: string;
}

export interface RecurringSeries {
  rule: { id: string; title: string; playbook: string; every: 'day' | 'week' | 'month'; carryOver: boolean; by: string };
  /** "every Mon 09:00 · skill: security-review" */
  words: string;
  runs: RecurringRun[];
  due: { period: string; label: string; since: number; words: string; dismissed: boolean } | null;
}

export interface StartedRun {
  planUid: string;
  title: string;
  /** False when the run was already there: started earlier, or by a teammate. */
  created: boolean;
  series: RecurringSeries[];
}

export async function listRecurring(): Promise<RecurringSeries[]> {
  return (await rpc<{ series: RecurringSeries[] }>('recurring.list', {})).series;
}

/** Start the run due now, as the person on this phone. */
export async function startRecurring(ruleId: string): Promise<StartedRun> {
  return rpc<StartedRun>('recurring.start', { ruleId });
}

const MARK: Record<RunState, string> = { done: '✓', in_progress: '◐', missed: '✗ missed', due: 'due', next: 'next' };

/** The mark a period carries in the row: "W39 ✗ missed", "W40 ◐". */
export function runMark(run: RecurringRun): string {
  return `${run.label} ${MARK[run.state]}`;
}

/** What starting said: "Started Weekly security review — W40" or "already started". */
export function startedLine(run: StartedRun): string {
  return run.created ? `Started ${run.title}` : `${run.title} was already started; opening it`;
}
