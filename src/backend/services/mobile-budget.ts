/**
 * A plan's budget on the paired phone (Phase 32, owner's request).
 *
 * Agents may change a plan's budget; a change an agent made is flagged
 * until a person marks it seen (0.4g). On the desktop the flag sits on the
 * budget chip. This carries the same thing to the phone, so a person away
 * from the desk sees it and can mark it seen there:
 *
 *   budget.get          time and cost against the ceiling, and the agent
 *                       changes still flagged, each in the desktop's words
 *   budget.acknowledge  the person has seen one change
 *
 * Marking a change seen puts the person's name to it, so, like a sign-off
 * from the phone (mobile-approvals), it needs a pairing that was confirmed
 * on the desktop, and it is written to the device audit trail.
 */

import * as budgetService from './budget-service';
import { getPlan } from './plan-service';
import { getAuthorKey } from './settings-service';
import { getPairedDevice } from './paired-device-service';
import { PeerAuthorizationError } from './peer-capabilities';
import { recordPeerAudit } from './peer-audit-service';
import { describeBudgetChange } from '../../shared/lib/budget-words';
import type { PeerContext } from './mobile-approvals';

export const BUDGET_METHODS = ['budget.get', 'budget.acknowledge'] as const;

/** A flagged change as the phone shows it: who, what in words, and when. */
export interface PhoneBudgetChange {
  id: number;
  by: string;
  byType: string;
  /** "raised the time ceiling 2h → 4h" — the desktop chip's words. */
  words: string;
  at: number;
}

export interface PhoneBudget {
  planUid: string;
  budget: { minutes: number | null; costUsd: number | null; exempt: boolean } | null;
  spentMinutes: number;
  /** Null when no agent reported a model: unknown, never zero. */
  spentCostUsd: number | null;
  flaggedChanges: PhoneBudgetChange[];
}

export async function handleBudgetMethod(
  method: string,
  params: Record<string, unknown>,
  peer: PeerContext,
): Promise<unknown> {
  switch (method) {
    case 'budget.get':
      return phoneBudget(requirePlan(params));
    case 'budget.acknowledge':
      return acknowledge(requirePlan(params), params.changeId, peer);
    default:
      throw new Error(`Unknown budget method: ${method}`);
  }
}

function requirePlan(params: Record<string, unknown>): string {
  const planUid = params.planUid;
  if (typeof planUid !== 'string' || !planUid) throw new Error('planUid is required');
  if (!getPlan(planUid)) throw new Error('Plan not found');
  return planUid;
}

export function phoneBudget(planUid: string): PhoneBudget {
  const report = budgetService.getBudgetReport(planUid);
  return {
    planUid,
    budget: report.budget
      ? { minutes: report.budget.minutes, costUsd: report.budget.costUsd, exempt: report.budget.exempt }
      : null,
    spentMinutes: report.spentMinutes,
    spentCostUsd: report.spentCostUsd,
    flaggedChanges: report.flaggedChanges.map((c) => ({
      id: c.id,
      by: c.actor,
      byType: c.actorType,
      words: describeBudgetChange(c.before, c.after),
      at: c.at,
    })),
  };
}

function acknowledge(planUid: string, changeId: unknown, peer: PeerContext): PhoneBudget {
  if (typeof changeId !== 'number' || !Number.isInteger(changeId)) throw new Error('changeId must be a number');
  const device = getPairedDevice(peer.fingerprint);
  if (!device?.confirmedAt) {
    throw new PeerAuthorizationError('Marking a budget change seen needs a pairing confirmed on the desktop');
  }
  const change = budgetService.acknowledgeBudgetChange(planUid, changeId, getAuthorKey('human'));
  if (!change) throw new Error('No such budget change on this plan');
  recordPeerAudit({
    kind: 'decision',
    fingerprint: peer.fingerprint,
    alias: device.alias,
    method: 'budget.acknowledge',
    detail: `saw budget change ${changeId} on plan ${planUid}`,
  });
  peer.broadcast?.('plan-budget-changed', { planUid, acknowledged: changeId });
  return phoneBudget(planUid);
}
