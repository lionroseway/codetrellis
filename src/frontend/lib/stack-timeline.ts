/**
 * Phase 32 B6.4b — one selection: a plan chosen in the Stack tab narrows the
 * Timeline to its work (observability spec §5, design rule 9).
 *
 * A turn is the plan's work when its session is the one on one of the plan's
 * tasks, or when any call in it names the plan or one of its tasks (a claim,
 * an update, a comment). Pure: the caller passes the turns and the plan's
 * scope.
 */
import type { AgentTurn } from '../../shared/lib/agent-turns';

export interface PlanScope {
  planUid: string;
  taskUids: ReadonlySet<string>;
  sessions: ReadonlySet<string>;
}

/**
 * A call's arguments as text. They arrive as an object (live) or as a JSON
 * string that may be cut short (stored); either way a uid is a UUID, so
 * finding it in the text is exact enough, and survives the cut.
 */
function argsText(args: unknown): string {
  if (typeof args === 'string') return args;
  if (args == null) return '';
  try { return JSON.stringify(args); } catch { return ''; }
}

export function turnInPlan(turn: AgentTurn, scope: PlanScope): boolean {
  if (turn.sessionId && scope.sessions.has(turn.sessionId)) return true;
  const uids = [scope.planUid, ...scope.taskUids];
  return turn.events.some((event) => {
    const text = argsText(event.payload?.args);
    return text !== '' && uids.some((uid) => text.includes(uid));
  });
}
