/**
 * A project's freeze on the paired phone (owner's decision, Phase 32 §0.4k).
 *
 * Agents may freeze, lift and exempt; an agent's change is flagged until a
 * person marks it seen. On the desktop the flag sits on the freeze bar. This
 * carries the same thing to the phone:
 *
 *   freeze.get          the freeze on a plan's project, and the agent changes
 *                       still flagged, each in the desktop's words
 *   freeze.acknowledge  the person has seen one change
 *
 * Asked by plan, not by path: the project comes from the stored plan (Phase 19
 * — never a root from the request). Marking a change seen puts the person's
 * name to it, so, like budget.acknowledge, it needs a pairing confirmed on the
 * desktop and is written to the device audit trail.
 */

import * as freezeService from './freeze-service';
import { getPlan } from './plan-service';
import { getAuthorKey } from './settings-service';
import { getPairedDevice } from './paired-device-service';
import { PeerAuthorizationError } from './peer-capabilities';
import { recordPeerAudit } from './peer-audit-service';
import { resolveTrustedProjectRoot } from './trusted-roots';
import { describeFreezeChange } from '../../shared/lib/freeze-words';
import type { PeerContext } from './mobile-approvals';

export const FREEZE_METHODS = ['freeze.get', 'freeze.acknowledge'] as const;

export interface PhoneFreeze {
  planUid: string;
  active: boolean;
  reason: string | null;
  until: string | null;
  /** This plan may go ahead during the freeze. */
  planExempt: boolean;
  flaggedChanges: Array<{ id: number; by: string; byType: string; words: string; at: number }>;
}

export async function handleFreezeMethod(
  method: string,
  params: Record<string, unknown>,
  peer: PeerContext,
): Promise<unknown> {
  switch (method) {
    case 'freeze.get':
      return phoneFreeze(requirePlan(params));
    case 'freeze.acknowledge':
      return acknowledge(requirePlan(params), params.changeId, peer);
    default:
      throw new Error(`Unknown freeze method: ${method}`);
  }
}

function requirePlan(params: Record<string, unknown>): string {
  const planUid = params.planUid;
  if (typeof planUid !== 'string' || !planUid) throw new Error('planUid is required');
  if (!getPlan(planUid)) throw new Error('Plan not found');
  return planUid;
}

function projectOf(planUid: string): string {
  const plan = getPlan(planUid);
  if (!plan?.projectPath) throw new Error('This plan is not in a project');
  return resolveTrustedProjectRoot(plan.projectPath, 'plan.projectPath');
}

export function phoneFreeze(planUid: string): PhoneFreeze {
  const status = freezeService.getFreezeStatus(projectOf(planUid));
  return {
    planUid,
    active: status.active,
    reason: status.reason,
    until: status.until,
    planExempt: status.allowedPlanUids.includes(planUid),
    flaggedChanges: status.flaggedChanges.map((c) => ({
      id: c.id,
      by: c.actor,
      byType: c.actorType,
      words: describeFreezeChange(c.before, c.after),
      at: c.at,
    })),
  };
}

function acknowledge(planUid: string, changeId: unknown, peer: PeerContext): PhoneFreeze {
  if (typeof changeId !== 'number' || !Number.isInteger(changeId)) throw new Error('changeId must be a number');
  const device = getPairedDevice(peer.fingerprint);
  if (!device?.confirmedAt) {
    throw new PeerAuthorizationError('Marking a freeze change seen needs a pairing confirmed on the desktop');
  }
  const projectPath = projectOf(planUid);
  const change = freezeService.acknowledgeFreezeChange(projectPath, changeId, getAuthorKey('human'));
  if (!change) throw new Error('No such freeze change on this project');
  recordPeerAudit({
    kind: 'decision',
    fingerprint: peer.fingerprint,
    alias: device.alias,
    method: 'freeze.acknowledge',
    detail: `saw freeze change ${changeId} on ${projectPath}`,
  });
  peer.broadcast?.('freeze-changed', { projectRoot: projectPath, acknowledged: changeId });
  return phoneFreeze(planUid);
}
