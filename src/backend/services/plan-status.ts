/**
 * A plan's status, read and never written (Phase 32 C2.4, shared-work doc
 * C-2 §1).
 *
 * Every item gets a state with its source: git or the review host for an
 * item on a branch (item-git-state.ts), the plan itself for everything else
 * (its status, criteria and sign-off, and who recorded the status). The
 * window's /api/plans/:uid/status, the phone's `plan.status` and get_plan's
 * `status` are this one answer. There is no summary file: a generated file
 * that is committed drifts, and one rewritten on every change is noise in
 * git and a clash waiting to happen in a synced folder.
 */

import { getPlan } from './plan-service';
import { listAllItems } from './plan-item-service';
import { listPlanEvents } from './plan-event-service';
import { listCriteria } from './criteria-service';
import { getExternalRefsByPlan } from './external-refs-service';
import { getPlanExternalRefs } from './external-intake-service';
import { planGitStates, planGitStatesFresh, type PlanItemGitState } from './item-git-state';
import { allHeadChecks, allSplits } from './task-records/heads';
import {
  itemStatuses, planStatusView,
  type CriteriaTally, type ItemStatus, type PlanItemFacts, type PlanStatusView, type StateRecord,
} from '../../shared/lib/item-status';

export interface PlanStatus extends PlanStatusView {
  planUid: string;
  title: string;
  /** The base the plan's branches merge into, when git knows it. */
  base: string | null;
  items: ItemStatus[];
}

/**
 * The newest status change of each item, from the plan's own events. One
 * taken from a teammate's record carries whether that record verified, as
 * checked now (C3.3): trusting a key later changes what it says.
 */
function statusRecords(planUid: string): Map<string, StateRecord> {
  const out = new Map<string, StateRecord>();
  const checks = allHeadChecks();
  for (const e of listPlanEvents(planUid, { eventTypes: ['status_changed'], limit: 10_000 })) {
    if (!e.itemUid || out.has(e.itemUid)) continue;
    const check = e.authorType === 'record' ? checks.get(e.itemUid) ?? null : null;
    const by = check ? (check.verified && check.author ? check.author : check.claimed) : e.author;
    out.set(e.itemUid, { by, byType: e.authorType, at: e.createdAt, ...(check ? { check } : {}) });
  }
  return out;
}

function criteriaOf(itemUid: string): CriteriaTally | null {
  let list: ReturnType<typeof listCriteria>;
  try { list = listCriteria(itemUid); } catch { return null; }
  if (list.length === 0) return null;
  const met = list.filter((c) => c.state === 'met');
  const awaiting = list.filter((c) => c.state === 'submitted').length;
  let signedOffBy: string | null = null;
  if (met.length === list.length) {
    const last = met
      .map((c) => c.latestSignoff)
      .filter((s): s is NonNullable<typeof s> => !!s && s.decision === 'approved')
      .sort((a, b) => b.createdAt - a.createdAt)[0];
    signedOffBy = last?.actor ?? null;
  }
  return { met: met.length, total: list.length, awaiting, signedOffBy };
}

/** The plan's ticket keys: its own (set_plan_external_ref, an intake), then its items'. */
function ticketsOf(planUid: string): string[] {
  const keys: string[] = [];
  try { keys.push(...getPlanExternalRefs(planUid).map((r) => r.externalKey).filter((k): k is string => !!k)); } catch { /* none */ }
  try { keys.push(...getExternalRefsByPlan(planUid).map((r) => r.externalKey).filter((k): k is string => !!k)); } catch { /* none */ }
  return [...new Set(keys)];
}

function build(planUid: string, git: { base: string | null; items: PlanItemGitState[] } | null): PlanStatus | null {
  const plan = getPlan(planUid);
  if (!plan) return null;
  const records = statusRecords(planUid);
  const items = listAllItems(planUid);
  const splits = allSplits();
  const facts: PlanItemFacts[] = items.map((i) => ({
    uid: i.uid, title: i.title, kind: i.kind, parentUid: i.parentUid,
    status: i.status ?? null, assignee: i.assignee ?? null,
    progressPercent: i.progressPercent ?? null, blockedReason: i.blockedReason ?? null,
    criteria: i.kind === 'action' ? criteriaOf(i.uid) : null,
    recorded: records.get(i.uid) ?? null,
    atOnce: splits.get(i.uid) ?? null,
  }));
  const byItem = new Map((git?.items ?? []).map((s) => [s.itemUid, s]));
  const statuses = itemStatuses(facts, byItem);
  const newest = Math.max(0, ...[...records.values()].map((r) => r.at), ...items.map((i) => i.updatedAt ?? 0));
  return {
    planUid, title: plan.title, base: git?.base ?? null, items: statuses,
    ...planStatusView(statuses, ticketsOf(planUid), newest || null),
  };
}

/** The plan's status from what is kept: git as it stands and what the host last said. */
export function planStatus(planUid: string): PlanStatus | null {
  return build(planUid, planGitStates(planUid));
}

/** The same, after asking the review host about any branch whose answer is stale (when one is on). */
export async function planStatusFresh(planUid: string): Promise<PlanStatus | null> {
  return build(planUid, await planGitStatesFresh(planUid));
}
