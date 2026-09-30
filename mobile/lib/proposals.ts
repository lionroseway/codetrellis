/**
 * Proposed spec changes on the phone (Phase 32 B7.6) — the calls, and their
 * shapes.
 *
 * Mirrors `src/backend/services/mobile-proposals.ts` on the desktop. The
 * words (`headline`, `replies`, each impact's `label` and `who`) are the
 * desktop's own, so a proposal reads the same on both. A decision made here
 * is the person's, only for a pairing confirmed on the desktop; the desktop
 * enforces that and says so when it refuses. Amending needs the text edited,
 * which is done in the window.
 */

import { rpc } from './rpc';

export type ProposalDecision = 'accept' | 'reject';

export interface PhoneProposal {
  uid: string;
  hitRef: string | null;
  status: 'open' | 'accepted' | 'rejected' | 'withdrawn';
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
  /** The person's note on a spec breakpoint guarding the page. */
  guardNote: string | null;
  guarded: boolean;
  createdAt: number;
  decidedAt: number | null;
  decisionNote: string | null;
}

/** Open proposals in the opened project, oldest first. */
export async function listProposals(): Promise<PhoneProposal[]> {
  const { proposals } = await rpc<{ proposals: PhoneProposal[] }>('proposal.list', {});
  return Array.isArray(proposals) ? proposals : [];
}

export async function getProposal(uid: string): Promise<PhoneProposal> {
  const { proposal } = await rpc<{ proposal: PhoneProposal }>('proposal.get', { uid });
  return proposal;
}

/**
 * Accept or reject. `alreadyDecided` means someone decided first; `proposal`
 * then carries the decision that stood. `flagged` is how many relying tasks
 * were marked "spec changed".
 */
export function decideProposal(
  uid: string,
  decision: ProposalDecision,
  note?: string,
): Promise<{ proposal: PhoneProposal; flagged?: number; alreadyDecided?: true }> {
  return rpc('proposal.decide', { uid, decision, ...(note ? { note } : {}) });
}
