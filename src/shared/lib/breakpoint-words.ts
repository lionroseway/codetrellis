/**
 * How a held call reads to a person (Phase 32 B4.3, shared in B4.4). Pure,
 * and shared by the desktop's waiting list and the phone, so both say the
 * same thing about the same hit, as `freeze-words.ts` does for a freeze.
 *
 * A breach is never worded as a pause: it happened, and could not be
 * stopped (observability doc §10.3).
 */

import type { BreakpointHit, BreakpointDecision } from '../types';

/** An agent as a person knows it. */
export function agentName(agent: string | null): string {
  if (!agent) return 'An agent';
  if (agent === 'claude-code' || agent === 'claude-code-hook') return 'Claude Code';
  if (agent === 'mcp-agent') return 'An agent';
  return agent;
}

const DOING: Record<BreakpointHit['action'], string> = {
  claim: 'claim', done: 'mark done', edit: 'change the description of', delete: 'delete', edit_code: 'change', breach: 'change',
};

/** What the held call is about, in words: a function in its file (B4.2c), a file, or the item. */
export function subjectOf(hit: Pick<BreakpointHit, 'path' | 'itemTitle' | 'itemUid'> & { breakpointTarget?: string | null }): string {
  const at = hit.breakpointTarget ? hit.breakpointTarget.indexOf('#') : -1;
  if (hit.path && at > 0) return `${hit.breakpointTarget!.slice(at + 1)} in ${hit.path}`;
  return hit.path ?? hit.itemTitle ?? hit.itemUid;
}

/** The first line of a waiting card. `where` is the workstream's label, when known. */
export function hitHeadline(hit: BreakpointHit, where?: string | null): string {
  const who = agentName(hit.agent);
  const inWs = where ? ` in ${where}` : '';
  if (hit.breach) return `${who}${inWs} changed ${subjectOf(hit)} past a breakpoint`;
  return `${who}${inWs} wants to ${DOING[hit.action]} “${subjectOf(hit)}”`;
}

/** Why it is waiting on the person: which breakpoint, in their terms. */
export function hitWhy(hit: BreakpointHit): string {
  if (hit.breach) return 'It could not be paused: this agent edits with its own editor. It has been told to stop and wait.';
  switch (hit.kind) {
    case 'task': return 'You asked to be asked before an agent claims or finishes this task.';
    case 'spec': return 'You asked to be asked before an agent changes this description.';
    case 'code': return 'You asked to be asked before this code changes. The edit was not made.';
    case 'signal': return 'A serious signal names this workstream, and you asked to be asked while one is open.';
    default: return 'You set a breakpoint here.';
  }
}

/** The three answers, worded for a pause or a breach. */
export function decisionLabels(hit: Pick<BreakpointHit, 'breach'>): Record<BreakpointDecision, string> {
  return hit.breach
    ? { continue: 'Carry on', steer: 'Carry on with this note', stop: 'Stop' }
    : { continue: 'Continue', steer: 'Continue with steer', stop: 'Stop' };
}
