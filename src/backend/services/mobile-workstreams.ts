/**
 * Workstreams on the phone (Phase 32 A4.3, awareness spec §8.2).
 *
 * The strip, pulled over RPC: each line of parallel work with its branch,
 * its agents, the tasks they hold, what it has changed and the signals that
 * name it. One opens to its changed files and its recent turns, grouped and
 * summarised the way the desktop's Timeline does (`agent-turns.ts`, shared).
 *
 * Read-only. A workstream is picked by id among those `listWorkstreams`
 * found for the opened project, never a folder from the request.
 */

import fs from 'node:fs';
import { listWorkstreams } from './workstream-service';
import { listTaskWorkstreams, taskLabel } from './task-workstreams';
import { listSignals } from './awareness-service';
import { listAgentEvents } from './agent-event-log';
import { getDb } from './database';
import { chipLabel } from '../../shared/lib/workstream-words';
import { groupIntoTurns } from '../../shared/lib/agent-turns';
import type { PeerContext } from './mobile-approvals';
import type { ChangedFileStatus, Workstream, WorkstreamShape } from '../../shared/types';

export const WORKSTREAM_METHODS = ['workstreams.list', 'workstreams.detail'] as const;

/** How many recent turns a workstream's detail shows. */
export const PHONE_TURNS = 10;

export interface PhoneWorkstream {
  /** Its folder, or `branch:<name>`: the id `workstreams.detail` takes. */
  id: string;
  /** As the strip names it. */
  name: string;
  branch: string | null;
  shape: WorkstreamShape;
  main: boolean;
  agents: Array<{ agentType: string; model: string | null; source: 'mcp' | 'claude-log'; lastSeen: number | null }>;
  /** Unfinished tasks its agents have claimed. */
  tasks: Array<{ uid: string; title: string; planUid: string; status: string }>;
  changedFiles: number;
  /** Live signals naming it. */
  signals: number;
  /** Of those, the ones that need the person (open, high or medium). */
  needsYou: number;
}

export interface PhoneTurn {
  sessionId: string | null;
  agentType: string | null;
  startedAt: number;
  endedAt: number;
  /** The Timeline's one line for it. */
  summary: string;
  calls: number;
  files: string[];
  hasError: boolean;
  mutating: boolean;
}

export interface PhoneWorkstreamDetail extends PhoneWorkstream {
  files: Array<{ path: string; status: ChangedFileStatus; added?: number; removed?: number }>;
  /** More files changed than are listed. */
  truncated: boolean;
  ahead?: number;
  behind?: number;
  /** Its most recent turns, newest first. */
  turns: PhoneTurn[];
}

export async function handleWorkstreamMethod(
  method: string,
  params: Record<string, unknown>,
  _peer: PeerContext,
  ctx: { projectRoot: string | null },
): Promise<unknown> {
  switch (method) {
    case 'workstreams.list':
      return { projectRoot: ctx.projectRoot, workstreams: phoneWorkstreams(ctx.projectRoot), tasks: phoneTaskWorkstreams(ctx.projectRoot) };
    case 'workstreams.detail': {
      const id = params.id;
      if (typeof id !== 'string' || !id) throw new Error('id is required');
      return { workstream: phoneWorkstream(ctx.projectRoot, id) };
    }
    default:
      throw new Error(`Unknown workstream method: ${method}`);
  }
}

/** The project's lines of work, as the strip shows them: idle ones left out. */
export function phoneWorkstreams(projectRoot: string | null): PhoneWorkstream[] {
  if (!projectRoot) return [];
  return listWorkstreams(projectRoot).map((w) => toPhone(projectRoot, w));
}

/** A task worked as a workstream (A6.1), as the phone lists it. */
export interface PhoneTaskWorkstream {
  id: string;
  itemUid: string;
  name: string;
  planUid: string;
  planTitle: string;
  status: string;
  agents: Array<{ agentType: string; model: string | null; lastSeen: number | null }>;
  materials: number;
  outputs: number;
  signals: number;
  needsYou: number;
}

/** Tasks a session is on (A6.1), as the strip shows them. */
export function phoneTaskWorkstreams(projectRoot: string | null): PhoneTaskWorkstream[] {
  if (!projectRoot) return [];
  return listTaskWorkstreams(projectRoot).map((t) => {
    const signals = listSignals(projectRoot, { workstream: t.id });
    return {
      id: t.id, itemUid: t.itemUid, name: taskLabel(t), planUid: t.planUid, planTitle: t.planTitle, status: t.status,
      agents: t.agents.map((a) => ({ agentType: a.agentType, model: a.model, lastSeen: a.lastSeen })),
      materials: t.materials, outputs: t.outputs,
      signals: signals.filter((s) => s.state !== 'intended' && s.state !== 'dismissed').length,
      needsYou: signals.filter((s) => s.state === 'open' && s.severity !== 'low').length,
    };
  });
}

/** One workstream, with its changed files and recent turns. */
export function phoneWorkstream(projectRoot: string | null, id: string): PhoneWorkstreamDetail {
  if (!projectRoot) throw new Error('No project is open on the desktop');
  const w = listWorkstreams(projectRoot, { includeIdle: true }).find((x) => x.root === id);
  if (!w) throw new Error('No such workstream in this project');
  return {
    ...toPhone(projectRoot, w),
    files: w.changes.files.map((f) => ({
      path: f.path, status: f.status,
      ...(typeof f.added === 'number' ? { added: f.added } : {}),
      ...(typeof f.removed === 'number' ? { removed: f.removed } : {}),
    })),
    truncated: w.changes.truncated,
    ...(typeof w.changes.ahead === 'number' ? { ahead: w.changes.ahead } : {}),
    ...(typeof w.changes.behind === 'number' ? { behind: w.changes.behind } : {}),
    turns: turnsIn(w),
  };
}

function toPhone(projectRoot: string, w: Workstream): PhoneWorkstream {
  const signals = w.root.startsWith('branch:') ? [] : listSignals(projectRoot, { workstream: w.root });
  return {
    id: w.root,
    name: chipLabel(w),
    branch: w.branch,
    shape: w.shape,
    main: w.main,
    agents: w.agents.map((a) => ({ agentType: a.agentType, model: a.model, source: a.source, lastSeen: a.lastSeen })),
    tasks: tasksOf(w),
    changedFiles: w.changes.files.length,
    signals: signals.filter((s) => s.state !== 'intended' && s.state !== 'dismissed').length,
    needsYou: signals.filter((s) => s.state === 'open' && s.severity !== 'low').length,
  };
}

function tasksOf(w: Workstream): PhoneWorkstream['tasks'] {
  const sessions = w.agents.map((a) => a.sessionId);
  if (sessions.length === 0) return [];
  const res = getDb().exec(
    `SELECT uid, title, plan_uid, status FROM plan_items
      WHERE assignee_session IN (${sessions.map(() => '?').join(',')}) AND status IN ('assigned', 'in_progress')
      ORDER BY updated_at DESC`,
    sessions,
  );
  return (res[0]?.values ?? []).map(([uid, title, planUid, status]) => ({ uid: uid as string, title: title as string, planUid: planUid as string, status: status as string }));
}

/**
 * Its recent turns. Events carry the root the session was bound to as
 * opened, and git lists it by real path: both are asked for.
 */
function turnsIn(w: Workstream): PhoneTurn[] {
  if (w.root.startsWith('branch:')) return [];
  const roots = new Set([w.root]);
  try { roots.add(fs.realpathSync.native(w.root)); } catch { /* the listed one alone */ }
  const events = [...roots].flatMap((r) => listAgentEvents({ workstreamRoot: r, limit: 300 }));
  const seen = new Set<string>();
  const unique = events.filter((e) => (seen.has(e.id) ? false : (seen.add(e.id), true)));
  // The Timeline groups by the payload's session; stored events carry it on the row.
  const withSession = unique.map((e) => ({ ...e, payload: { ...e.payload, sessionId: e.sessionId ?? e.payload.sessionId, agentType: e.agentType ?? e.payload.agentType } }));
  // A session is named by a guess at connect (`mcp-client`) until the client
  // says what it is, and the events before that keep the guess: name each
  // turn by its session as it stands now.
  const named = new Map(w.agents.map((a) => [a.sessionId, a.agentType]));
  return groupIntoTurns(withSession)
    .slice(-PHONE_TURNS)
    .reverse()
    .map((t) => ({
      sessionId: t.sessionId, agentType: (t.sessionId && named.get(t.sessionId)) || t.agentType, startedAt: t.startedAt, endedAt: t.endedAt,
      summary: t.summary, calls: t.events.length, files: t.files, hasError: t.hasError, mutating: t.mutating,
    }));
}
