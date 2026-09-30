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
  propose: 'change the spec', disk: 'change',
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
  // A plan document's file, edited on disk (B7.5b): who did it cannot be told.
  if (hit.action === 'disk') return `“${subjectOf(hit)}” changed on disk`;
  return `${who}${inWs} wants to ${DOING[hit.action]} “${subjectOf(hit)}”`;
}

/** "3 tasks in 2 plans rely on this page" (B7.5a). */
export function reliedOnLine(r: { tasks: number; plans: number }): string {
  const tasks = `${r.tasks} ${r.tasks === 1 ? 'task' : 'tasks'}`;
  const plans = `${r.plans} ${r.plans === 1 ? 'plan' : 'plans'}`;
  return `${tasks} in ${plans} ${r.tasks === 1 ? 'relies' : 'rely'} on this page`;
}

/** Why it is waiting on the person: which breakpoint, in their terms. */
export function hitWhy(hit: BreakpointHit): string {
  if (hit.breach) return 'It could not be paused: this agent edits with its own editor. It has been told to stop and wait.';
  switch (hit.kind) {
    case 'task': return 'You asked to be asked before an agent claims or finishes this task.';
    case 'spec':
      if (hit.action === 'disk') {
        return 'You guard this document. Its file changed on disk, and the app kept its own version until you decide: apply the file to take its version, or keep the app\'s and it is written back to the file.';
      }
      // An edit to a page others rely on (B7.5a): the agent was told to propose it instead.
      if (hit.reliedOn && hit.reliedOn.tasks > 0) {
        return `You asked to be asked before an agent changes this description. ${reliedOnLine(hit.reliedOn)}; the agent was told a proposal would let their agents weigh in.`;
      }
      return 'You asked to be asked before an agent changes this description.';
    case 'code': return 'You asked to be asked before this code changes. The edit was not made.';
    case 'signal': return 'A serious signal names this workstream, and you asked to be asked while one is open.';
    case 'proposal': return 'A spec others rely on would change. Nothing changes until you decide.';
    default: return 'You set a breakpoint here.';
  }
}

/** The three answers, worded for a pause or a breach. */
export function decisionLabels(hit: Pick<BreakpointHit, 'breach'> & { action?: BreakpointHit['action'] }): Record<BreakpointDecision, string> {
  if (hit.action === 'disk') return { continue: 'Apply the file', steer: 'Apply the file, with a note', stop: 'Keep the app\'s version' };
  return hit.breach
    ? { continue: 'Carry on', steer: 'Carry on with this note', stop: 'Stop' }
    : { continue: 'Continue', steer: 'Continue with steer', stop: 'Stop' };
}

/**
 * The lines that differ between two versions of a document, with a line of
 * context either side (B7.5b): what a person needs to see to decide, rather
 * than two whole documents to compare by eye.
 */
export function changedLines(before: string, after: string, context = 1): { before: string; after: string; from: number } {
  // Only the title changed: no lines to show.
  if (before.replace(/\n+$/, '') === after.replace(/\n+$/, '')) return { before: '', after: '', from: 1 };
  const a = before.replace(/\n+$/, '').split('\n');
  const b = after.replace(/\n+$/, '').split('\n');
  let start = 0;
  while (start < a.length && start < b.length && a[start] === b[start]) start++;
  let endA = a.length;
  let endB = b.length;
  while (endA > start && endB > start && a[endA - 1] === b[endB - 1]) { endA--; endB--; }
  const from = Math.max(0, start - context);
  return {
    before: a.slice(from, Math.min(a.length, endA + context)).join('\n'),
    after: b.slice(from, Math.min(b.length, endB + context)).join('\n'),
    from: from + 1,
  };
}
