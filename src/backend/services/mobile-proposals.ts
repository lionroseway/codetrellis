/**
 * Proposed spec changes on the phone (Phase 32 B7.6).
 *
 * The phone shows a proposal the way the desktop's inbox does, in the same
 * words (`proposal-words.ts`): what would change and why, the text now and
 * proposed, and what every relying plan replied. The person accepts or
 * rejects it from the phone; amending needs the text edited, which is the
 * window's. A decision is the person's, never an agent's: it needs a pairing
 * confirmed on the desktop, is audited, and its author is the person on the
 * phone (`phonePerson()`), never a name from the request.
 */

import { decideProposal, decisionProblem, getProposal, listProposals, type SpecProposal } from './spec-proposals-service';
import { getPairedDevice } from './paired-device-service';
import { PeerAuthorizationError } from './peer-capabilities';
import { recordPeerAudit } from './peer-audit-service';
import { evidenceWords, impactLabel, impactWho, proposalHeadline, proposalWhere, repliesLine } from '../../shared/lib/proposal-words';
import type { PeerContext } from './mobile-approvals';

export const PROPOSAL_METHODS = ['proposal.list', 'proposal.get', 'proposal.decide'] as const;

/** A proposal as the phone shows it: words first, then the ids it opens. */
export interface PhoneProposal {
  uid: string;
  /** Its entry in Waiting on you. */
  hitRef: string | null;
  status: SpecProposal['status'];
  headline: string;
  where: string;
  why: string;
  /** `tests invoice_eu.spec`, or '' when none was given. */
  evidence: string;
  before: string;
  proposed: string;
  /** `1 task in 1 plan relies on this. 1 of 1 replied.` */
  replies: string;
  impacts: Array<{ impact: 'none' | 'changes'; label: string; who: string; words: string }>;
  pageChangedSince: boolean;
  /** The person's note on a spec breakpoint guarding the page (B7.5a). */
  guardNote: string | null;
  guarded: boolean;
  createdAt: number;
  decidedAt: number | null;
  decisionNote: string | null;
}

export interface PhoneProposalContext {
  /** Who decides: the person on the phone (`phonePerson()`). */
  who: { author: string; authorType: 'human' };
  projectRoot: string | null;
}

export async function handleProposalMethod(
  method: string,
  params: Record<string, unknown>,
  peer: PeerContext,
  ctx: PhoneProposalContext,
): Promise<unknown> {
  switch (method) {
    case 'proposal.list':
      return { proposals: listProposals({ status: 'open', ...(ctx.projectRoot ? { projectPath: ctx.projectRoot } : {}) }).reverse().map(toPhoneProposal) };
    case 'proposal.get': {
      const p = typeof params.uid === 'string' ? getProposal(params.uid) : null;
      if (!p) throw new Error('No such proposal');
      return { proposal: toPhoneProposal(p) };
    }
    case 'proposal.decide':
      return decide(params, peer, ctx);
    default:
      throw new Error(`Unknown proposal method: ${method}`);
  }
}

export function toPhoneProposal(p: SpecProposal): PhoneProposal {
  return {
    uid: p.uid,
    hitRef: p.hitRef,
    status: p.status,
    headline: proposalHeadline(p),
    where: proposalWhere(p),
    why: p.why,
    evidence: evidenceWords(p.evidence),
    before: p.beforeText,
    proposed: p.proposedText,
    replies: repliesLine(p),
    impacts: p.impacts.map((i) => ({ impact: i.impact, label: impactLabel(i), who: impactWho(i), words: i.words })),
    pageChangedSince: p.pageChangedSince,
    guardNote: p.pageBreakpoint?.note ?? null,
    guarded: !!p.pageBreakpoint,
    createdAt: p.createdAt,
    decidedAt: p.decidedAt,
    decisionNote: p.decisionNote,
  };
}

/** Accept or reject, as the person on the phone. `alreadyDecided` with the decision that stood when someone decided first. */
function decide(params: Record<string, unknown>, peer: PeerContext, ctx: PhoneProposalContext): { proposal: PhoneProposal; flagged?: number; alreadyDecided?: true } {
  const uid = params.uid;
  if (typeof uid !== 'string' || !uid) throw new Error('uid is required');
  const decision = params.decision;
  if (decision !== 'accept' && decision !== 'reject') throw new Error('On the phone a proposal is accepted or rejected; amending it is done in the window.');
  const device = getPairedDevice(peer.fingerprint);
  if (!device?.confirmedAt) {
    throw new PeerAuthorizationError('Deciding a spec change needs a pairing confirmed on the desktop');
  }
  const existing = getProposal(uid);
  if (!existing) throw new Error('No such proposal');
  if (existing.status !== 'open') return { proposal: toPhoneProposal(existing), alreadyDecided: true };
  const input = { uid, decision, note: typeof params.note === 'string' ? params.note : undefined } as const;
  const problem = decisionProblem(input);
  if (problem) throw new Error(problem);
  const { proposal, flagged } = decideProposal(input, ctx.who);
  recordPeerAudit({
    kind: 'decision',
    fingerprint: peer.fingerprint,
    alias: device.alias,
    method: 'proposal.decide',
    detail: `${decision} on spec proposal ${uid}`,
  });
  // The window's inbox, lanes and page refresh on these, as they do for a decision made there.
  peer.broadcast?.('spec-proposal-decided', { uid: proposal.uid, status: proposal.status, pageUid: proposal.pageUid });
  if (proposal.hitRef) peer.broadcast?.('breakpoint-answered', { ref: proposal.hitRef, planUid: proposal.planUid, decision: proposal.status === 'rejected' ? 'stop' : 'continue' });
  if (proposal.status === 'accepted') peer.broadcast?.('plan-item-updated', { planUid: proposal.planUid, itemUid: proposal.pageUid, kind: 'object', changes: { body: true } });
  return { proposal: toPhoneProposal(proposal), flagged: flagged.length };
}
