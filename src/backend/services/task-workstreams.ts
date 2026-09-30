/**
 * Tasks as workstreams (Phase 32 A6.1, awareness spec §10.1).
 *
 * Work that is not code has the same parallel problem: one person runs
 * several Claude Desktop sessions on several tasks, and the tasks share
 * material. A code workstream is a folder; Claude Desktop has none, so a
 * session binds to the task it calls `get_brief` on (`bindBrief`), and the
 * task is the workstream, named `task:<item uid>` wherever a signal names
 * its workstreams.
 *
 * Kept apart from `listWorkstreams`, whose workstreams are git's (a folder
 * or a branch, with changed files): the review queue, the stack and the code
 * signals read those, and a task is none of them.
 */

import { getDb } from './database';
import { getActiveSessions } from './session-service';
import type { AgentSessionInfo, WorkstreamAgent } from '../../shared/types';

export const TASK_PREFIX = 'task:';

export function taskWorkstreamId(itemUid: string): string {
  return `${TASK_PREFIX}${itemUid}`;
}

export function isTaskWorkstream(id: string): boolean {
  return id.startsWith(TASK_PREFIX);
}

/** The workstreams a session belongs to: its folder, and its task. */
export function sessionWorkstreams(session: Pick<AgentSessionInfo, 'workstreamRoot' | 'briefItemUid'> | null | undefined): string[] {
  if (!session) return [];
  return [
    ...(session.workstreamRoot ? [session.workstreamRoot] : []),
    ...(session.briefItemUid ? [taskWorkstreamId(session.briefItemUid)] : []),
  ];
}

export interface TaskWorkstream {
  /** `task:<item uid>`, as a signal names it. */
  id: string;
  itemUid: string;
  title: string;
  status: string;
  planUid: string;
  planTitle: string;
  /** The sessions bound to it by `get_brief`, most recent first. */
  agents: WorkstreamAgent[];
  /** Files recorded on it (Phase 31): materials given, outputs written. */
  materials: number;
  outputs: number;
  /** No session is on it now. Left out unless asked for. */
  idle: boolean;
}

/**
 * The project's tasks worked as workstreams: every task a live session is
 * bound to, and, with `includeIdle`, every task with recorded materials or
 * outputs. The project is matched on how plans store it, with or without a
 * trailing separator.
 */
export function listTaskWorkstreams(projectRoot: string, opts: { includeIdle?: boolean } = {}): TaskWorkstream[] {
  const bound = new Map<string, AgentSessionInfo[]>();
  for (const s of getActiveSessions()) {
    if (!s.briefItemUid) continue;
    (bound.get(s.briefItemUid) ?? bound.set(s.briefItemUid, []).get(s.briefItemUid)!).push(s);
  }
  const trimmed = projectRoot.replace(/[\\/]+$/, '');
  const rows = getDb().exec(
    `SELECT i.uid, i.title, i.status, i.plan_uid, p.title,
            (SELECT COUNT(*) FROM attachments a WHERE a.target_uid = i.uid AND a.role = 'material'),
            (SELECT COUNT(*) FROM attachments a WHERE a.target_uid = i.uid AND a.role = 'output')
       FROM plan_items i JOIN plans p ON p.uid = i.plan_uid
      WHERE (p.project_path = ? OR p.project_path = ?)
        AND (i.uid IN (${[...bound.keys()].map(() => '?').join(',') || "''"})
             OR (? = 1 AND EXISTS (SELECT 1 FROM attachments a WHERE a.target_uid = i.uid AND a.role IN ('material', 'output'))))
      ORDER BY p.title, i.sort_order, i.title`,
    [projectRoot, trimmed, ...bound.keys(), opts.includeIdle ? 1 : 0],
  )[0]?.values ?? [];
  return rows.map((r) => {
    const itemUid = r[0] as string;
    const sessions = bound.get(itemUid) ?? [];
    return {
      id: taskWorkstreamId(itemUid),
      itemUid,
      title: r[1] as string,
      status: r[2] as string,
      planUid: r[3] as string,
      planTitle: r[4] as string,
      agents: sessions.map((s) => ({ sessionId: s.sessionId, agentType: s.agentType, model: s.model, source: 'mcp' as const, lastSeen: s.lastSeen })),
      materials: Number(r[5] ?? 0),
      outputs: Number(r[6] ?? 0),
      idle: sessions.length === 0,
    };
  });
}

/** "Task · Q3 summary", as the strip and the phone name it. */
export function taskLabel(t: Pick<TaskWorkstream, 'title'>): string {
  return `Task · ${t.title}`;
}
