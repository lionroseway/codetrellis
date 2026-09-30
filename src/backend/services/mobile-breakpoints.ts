/**
 * Breakpoints on the phone (Phase 32 B4.4).
 *
 * The phone lists what is held for the person, in the desktop's own words
 * (`breakpoint-words.ts`, `workstream-words.ts`), and answers it: continue,
 * continue with a note the agent reads, or stop. The first answer stands,
 * wherever it was given, so a phone answering a call the window already
 * answered gets the answer that stood, marked `alreadyAnswered`.
 *
 * Answering is a decision: it needs a pairing the person confirmed on the
 * desktop, as approving a criterion does (Phase 31 §12), and it is audited.
 * The author is the person on the phone, passed in by the router
 * (`phonePerson()`), never a name from the request.
 */

import { listHits, getHit, answerHit, cleanNote, DECISIONS } from './breakpoint-service';
import { releaseSettled } from './signal-breakpoints';
import { listWorkstreams } from './workstream-service';
import { getPairedDevice } from './paired-device-service';
import { PeerAuthorizationError } from './peer-capabilities';
import { recordPeerAudit } from './peer-audit-service';
import { hitHeadline, hitWhy, decisionLabels } from '../../shared/lib/breakpoint-words';
import { sideLabel } from '../../shared/lib/workstream-words';
import type { PeerContext } from './mobile-approvals';
import type { BreakpointDecision, BreakpointHit, Workstream } from '../../shared/types';

export const BREAKPOINT_METHODS = ['breakpoint.waiting', 'breakpoint.answer'] as const;

/** A held call as the phone shows it: words first, then the ids it opens. */
export interface PhoneHit {
  ref: string;
  /** It happened and could not be stopped; the agent was told to stop and wait. */
  breach: boolean;
  headline: string;
  why: string;
  /** The three answers, worded for a pause or a breach. */
  labels: Record<BreakpointDecision, string>;
  /** The person's own note on the breakpoint, when they left one. */
  breakpointNote: string | null;
  agent: string | null;
  planUid: string | null;
  itemUid: string | null;
  path: string | null;
  hitAt: number;
  decision: BreakpointDecision | null;
  note: string | null;
  answeredAt: number | null;
}

export interface PhoneBreakpointContext {
  /** Who is answering: the person on the phone (`phonePerson()`). */
  who: { author: string; authorType: 'human' };
  /** The opened project, for workstream names and settled signals. */
  projectRoot: string | null;
}

export async function handleBreakpointMethod(
  method: string,
  params: Record<string, unknown>,
  peer: PeerContext,
  ctx: PhoneBreakpointContext,
): Promise<unknown> {
  switch (method) {
    case 'breakpoint.waiting':
      return { hits: phoneWaiting(ctx.projectRoot) };
    case 'breakpoint.answer':
      return answer(params, peer, ctx);
    default:
      throw new Error(`Unknown breakpoint method: ${method}`);
  }
}

/**
 * What is held for the person, oldest first: the order they happened in.
 * A call held on a signal the person has since answered is let through
 * first, as the window's list does (B4.2b).
 */
export function phoneWaiting(projectRoot: string | null): PhoneHit[] {
  if (projectRoot) { try { releaseSettled(projectRoot); } catch { /* the list still answers */ } }
  const workstreams = workstreamsOf(projectRoot);
  return listHits({ state: 'waiting' }).map((h) => toPhoneHit(h, workstreams));
}

/** `{ hit }` once answered; `{ hit, alreadyAnswered: true }` with the answer that stood when someone answered first. */
function answer(params: Record<string, unknown>, peer: PeerContext, ctx: PhoneBreakpointContext): { hit: PhoneHit; alreadyAnswered?: true } {
  const ref = params.ref;
  if (typeof ref !== 'string' || !ref) throw new Error('ref is required');
  const decision = params.decision as BreakpointDecision;
  if (!DECISIONS.includes(decision)) throw new Error(`decision must be one of ${DECISIONS.join(', ')}`);
  if (decision === 'steer' && !cleanNote(params.note)) throw new Error('A steer needs a note for the agent');
  const device = getPairedDevice(peer.fingerprint);
  if (!device?.confirmedAt) {
    throw new PeerAuthorizationError('Answering a breakpoint needs a pairing confirmed on the desktop');
  }
  const hit = getHit(ref);
  if (!hit) throw new Error('No such breakpoint hit');
  if (hit.kind === 'proposal') throw new Error('A spec proposal is decided on the proposal: accept, amend or reject.');
  const workstreams = workstreamsOf(ctx.projectRoot);
  if (hit.answeredAt !== null) return { hit: toPhoneHit(hit, workstreams), alreadyAnswered: true };
  const answered = answerHit({ ref, decision, note: params.note, by: ctx.who.author, byType: ctx.who.authorType });
  if (!answered) return { hit: toPhoneHit(getHit(ref) ?? hit, workstreams), alreadyAnswered: true };
  recordPeerAudit({
    kind: 'decision',
    fingerprint: peer.fingerprint,
    alias: device.alias,
    method: 'breakpoint.answer',
    detail: `${decision} on breakpoint hit ${ref}`,
  });
  // The window's list and its lanes refresh on this, as they do for an answer given there.
  peer.broadcast?.('breakpoint-answered', { ref: answered.ref, planUid: answered.planUid, decision: answered.decision });
  return { hit: toPhoneHit(answered, workstreams) };
}

export function toPhoneHit(hit: BreakpointHit, workstreams: readonly Workstream[]): PhoneHit {
  const where = hit.workstreamRoot ? sideLabel(hit.workstreamRoot, workstreams) : null;
  return {
    ref: hit.ref,
    breach: hit.breach,
    headline: hitHeadline(hit, where),
    why: hitWhy(hit),
    labels: decisionLabels(hit),
    breakpointNote: hit.breakpointNote,
    agent: hit.agent,
    planUid: hit.planUid,
    itemUid: hit.itemUid,
    path: hit.path,
    hitAt: hit.hitAt,
    decision: hit.decision,
    note: hit.note,
    answeredAt: hit.answeredAt,
  };
}

function workstreamsOf(projectRoot: string | null): Workstream[] {
  if (!projectRoot) return [];
  try { return listWorkstreams(projectRoot, { includeIdle: true }); } catch { return []; }
}
