/**
 * How breakpoints read to a person (Phase 32 B4.3). Pure, so the words are
 * tested once and the waiting list, the set list and the task panel agree.
 *
 * A breach is never worded as a pause: it happened, and could not be
 * stopped (observability doc §10.3).
 */

import type { Breakpoint, BreakpointHit, BreakpointDecision } from '@shared/types';

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

/** A set breakpoint, as the list of breakpoints shows it. */
export function breakpointLabel(b: Breakpoint): { what: string; when: string } {
  const title = b.targetTitle ? `“${b.targetTitle}”` : 'an item';
  switch (b.kind) {
    case 'task': return { what: `Task ${title}`, when: 'before an agent claims or finishes it, or anything under it' };
    case 'spec': return { what: `Description of ${title}`, when: 'before an agent changes it, or anything under it' };
    case 'code': {
      const [file, fn] = b.target.split('#');
      if (fn) return { what: `${fn} in ${file}`, when: 'before an edit touches it' };
      return { what: file.endsWith('/') ? `Everything in ${file}` : file, when: 'before it changes' };
    }
    case 'signal': return { what: `Any serious ${b.target} signal`, when: 'while one names a workstream' };
    default: return { what: b.target, when: '' };
  }
}
