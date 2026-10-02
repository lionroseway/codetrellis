/**
 * Phase 32 C4.2a — a recurring run started as its moment comes.
 *
 * The app acts only while it runs (shared-work doc C-4): each tick starts the
 * runs whose due moment fell since the last tick, in every opened project. A
 * run that fell due while the app was closed is not started here; the inbox
 * asks the person about it ("…is due since Monday 09:00. Start it?"), and a
 * period that passes unanswered reads missed. Starting is idempotent, so a
 * teammate's run that already arrived is found, not made again.
 */
import { currentPeriod, dueAt, periodId } from '../../shared/lib/recurrence';
import { listTrustedRoots } from './trusted-roots';
import { rulesOf, runUid, startRun, type StartedRun } from './recurring-service';
import { getPlan } from './plan-service';

/** Who starts a run the schedule starts: the app, on the rule a person set. */
const SCHEDULE = { author: 'schedule', authorType: 'system' } as const;

const tickMs = (): number => Number(process.env.CODETRELLIS_RECURRING_TICK_MS) || 60_000;

let lastTick: number | null = null;
let timer: NodeJS.Timeout | null = null;

/**
 * Start every run whose moment fell in (from, now], in the given projects.
 * Pure of the clock and the timer, so a test can hand it both.
 */
export function startRunsDueBetween(roots: string[], from: number, now: number): Array<{ root: string; run: StartedRun }> {
  const started: Array<{ root: string; run: StartedRun }> = [];
  for (const root of roots) {
    let rules;
    try { rules = rulesOf(root); } catch { continue; }
    for (const rule of rules) {
      const p = currentPeriod(rule, now);
      const at = dueAt(rule, p);
      if (at <= from || at > now || at < Date.parse(rule.since)) continue;
      if (getPlan(runUid(root, rule.id, periodId(p)))) continue;
      try {
        started.push({ root, run: startRun(root, rule.id, SCHEDULE, now) });
      } catch (err) {
        console.warn(`[Recurring] Could not start ${rule.title} in ${root}:`, err instanceof Error ? err.message : err);
      }
    }
  }
  return started;
}

/** Begin ticking: from now on, a run is started as its moment comes. */
export function startRecurringScheduler(onStarted: (root: string, run: StartedRun) => void): void {
  if (timer) return;
  lastTick = Date.now();
  timer = setInterval(() => {
    const now = Date.now();
    const from = lastTick ?? now;
    lastTick = now;
    for (const { root, run } of startRunsDueBetween(listTrustedRoots(), from, now)) onStarted(root, run);
  }, tickMs());
  timer.unref?.();
}

export function stopRecurringScheduler(): void {
  if (timer) clearInterval(timer);
  timer = null;
  lastTick = null;
}
