/**
 * Teammates' plans after a pull (Phase 32 C2.6a, shared-work doc C-2 §4).
 *
 * A plan that first reaches this machine through its files, after a pull or
 * a copy, is recorded with who added it and in which commit, as `git log`
 * says (the file's own `author` field is anyone's text, so it is not what is
 * shown). The plans list, the Stack, the plan's status view and `get_plan`
 * say "from Priya Shah, in 3f9c2e1". A plan made on this machine has no
 * arrival. Fetching stays the person's: the app never pulls on its own.
 */

import { getDb } from './database';
import { markDirty } from './persistence';
import { lastCommitOf } from './skill-arrival-service';
import type { PlanArrival } from '../../shared/types';

/** Record a plan's arrival from its `plan.yaml`, once. */
export function recordPlanArrival(planUid: string, planFile: string, now = Date.now()): PlanArrival {
  const { addedBy, commit } = lastCommitOf(planFile);
  getDb().run(
    `INSERT OR IGNORE INTO plan_arrivals (plan_uid, added_by, commit_sha, arrived_at) VALUES (?, ?, ?, ?)`,
    [planUid, addedBy, commit, now],
  );
  markDirty();
  return getPlanArrival(planUid) ?? { addedBy, commit, arrivedAt: now };
}

/**
 * An arrival seen before its files were committed learns who added it once
 * git has the commit. One already known is never rewritten: a later commit
 * to the plan is an edit, not its arrival.
 */
export function completePlanArrival(planUid: string, planFile: string): void {
  const known = getPlanArrival(planUid);
  if (!known || known.commit) return;
  const { addedBy, commit } = lastCommitOf(planFile);
  if (!commit) return;
  getDb().run(`UPDATE plan_arrivals SET added_by = ?, commit_sha = ? WHERE plan_uid = ? AND commit_sha IS NULL`, [addedBy, commit, planUid]);
  markDirty();
}

export function getPlanArrival(planUid: string): PlanArrival | null {
  const r = getDb().exec(`SELECT added_by, commit_sha, arrived_at FROM plan_arrivals WHERE plan_uid = ?`, [planUid])[0]?.values[0];
  return r ? { addedBy: (r[0] as string | null) ?? null, commit: (r[1] as string | null) ?? null, arrivedAt: r[2] as number } : null;
}

/** Every arrival, by plan, for a list of plans. */
export function allPlanArrivals(): Map<string, PlanArrival> {
  const out = new Map<string, PlanArrival>();
  for (const r of getDb().exec(`SELECT plan_uid, added_by, commit_sha, arrived_at FROM plan_arrivals`)[0]?.values ?? []) {
    out.set(r[0] as string, { addedBy: (r[1] as string | null) ?? null, commit: (r[2] as string | null) ?? null, arrivedAt: r[3] as number });
  }
  return out;
}

/** "from Priya Shah, in 3f9c2e1", or "arrived in its files, not committed yet". Pure. */
export function arrivalWords(a: PlanArrival): string {
  return a.addedBy && a.commit ? `from ${a.addedBy}, in ${a.commit}` : 'arrived in its files, not committed yet';
}
