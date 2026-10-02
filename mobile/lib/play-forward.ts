/**
 * Play-forward, on the phone (Phase 32 B9.4, over B9.3b's `playForward.*`).
 *
 * The desktop computes it: every active plan's planned changes, and where two
 * or more will meet if they go ahead ("◇ planned overlap"). The phone shows
 * the overlaps in the desktop's words with what was decided about each, and
 * decides one the way the window's bar does: re-sequence the plans, tell the
 * agents, or leave it. Mirrors `src/shared/types/play-forward.ts`, which the
 * Expo project cannot import.
 */

import { rpc } from './rpc';

export interface PlannedOverlapDecision {
  action: 'resequence' | 'tell' | 'leave';
  words: string;
  by: string;
  byType: string;
  at: number;
}

export interface PlannedOverlap {
  id: string;
  kind: 'file' | 'symbol' | 'material';
  subject: string;
  file: string | null;
  plans: Array<{ uid: string; label: string; tasks: Array<{ uid: string; title: string; change: string | null }> }>;
  serious: boolean;
  sequenced: boolean;
  words: string;
  decisions: PlannedOverlapDecision[];
  left: boolean;
}

export interface ApprovalNotice {
  id: number;
  planUid: string;
  planLabel: string;
  /** "Approving JIRA-150 puts it in a planned overlap" */
  title: string;
  overlaps: string[];
  at: number;
}

export interface PlayForward {
  project: string;
  plans: Array<{ uid: string; label: string; ahead: number }>;
  overlaps: PlannedOverlap[];
  words: string;
  /** Approvals that put a plan in a planned overlap, not yet marked seen on the desktop. */
  notices: ApprovalNotice[];
}

export async function getPlayForward(): Promise<PlayForward> {
  return rpc<PlayForward>('playForward.summary', {});
}

/** Decide one, as the person on this phone; the answer is play-forward as it now stands. */
export async function decideOverlap(
  overlapId: string,
  action: 'resequence' | 'tell' | 'leave',
  first?: string,
): Promise<{ playForward: Omit<PlayForward, 'notices'> }> {
  return rpc('playForward.decide', { overlapId, action, ...(first ? { first } : {}) });
}

/** "◇ will overlap JIRA-150: validators.ts", for each planned overlap a plan is in, as the desktop's stack says it. */
export function planOverlapLines(data: PlayForward | null, planUid: string): Array<{ id: string; words: string; serious: boolean; quiet: boolean }> {
  return (data?.overlaps ?? [])
    .filter((o) => o.plans.some((p) => p.uid === planUid))
    .map((o) => {
      const others = o.plans.filter((p) => p.uid !== planUid).map((p) => p.label);
      const name = o.kind === 'symbol' ? o.subject.split('#').pop()! : o.subject.split(/[\\/]/).pop()!;
      return { id: o.id, words: `◇ will overlap ${others.join(', ')}: ${name}${o.sequenced ? ' (sequenced)' : ''}`, serious: o.serious, quiet: o.sequenced || o.left };
    });
}

function hm(at: number): string {
  const d = new Date(at);
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

/** What was last decided about it, as the window says it: "Left as it is by Sam · 18:57". */
export function decisionLine(o: PlannedOverlap): string | null {
  const last = o.decisions[o.decisions.length - 1];
  if (!last) return null;
  return `${last.words}${last.action !== 'leave' ? ` · ${last.by}` : ''} · ${hm(last.at)}`;
}
