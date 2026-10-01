/**
 * Phase 32 B9.3a — what a person does about a planned overlap (WIREFRAMES §7:
 * [Re-sequence these plans] [Tell both agents] [Fine, leave it]).
 *
 *  - **Re-sequence**: the person picks which plan goes first; every task of
 *    the other plans in the overlap then waits on the first plan's tasks in
 *    it, through B6.1's dependencies, so the overlap reads "sequenced" and
 *    "what is next" holds the later work back. A choice that would make
 *    tasks wait on each other is refused.
 *  - **Tell both agents**: each session holding a task in it is told once,
 *    on its next call, what the other plan plans and who asked (as B7.3).
 *  - **Leave it**: kept with who and when; it stays, drawn quieter.
 *
 * Only a person decides: these are REST routes whose author comes from the
 * transport (`personFrom`), and no MCP tool reaches them. What was done is
 * kept by the overlap's id (its subject and its plans), so it carries over
 * as long as the same plans meet on the same thing.
 */
import { getDb } from './database';
import { markDirty } from './persistence';
import { buildPlayForward } from './play-forward';
import { getItem, updateItem } from './plan-item-service';
import type { PlannedOverlap, PlayForward } from '../../shared/types/play-forward';

export type OverlapAction = 'resequence' | 'tell' | 'leave';

export class OverlapActionError extends Error {
  constructor(public status: number, message: string) { super(message); }
}

const rows = (sql: string, params: unknown[] = []): unknown[][] => getDb().exec(sql, params)[0]?.values ?? [];

function find(projectRoot: string, overlapId: string): { forward: PlayForward; overlap: PlannedOverlap } {
  const forward = buildPlayForward(projectRoot);
  const overlap = forward.overlaps.find((o) => o.id === overlapId);
  if (!overlap) throw new OverlapActionError(404, 'No such planned overlap: the plans may have changed since. Play forward again.');
  return { forward, overlap };
}

function record(projectRoot: string, overlapId: string, action: OverlapAction, words: string, by: { author: string; authorType: string }, now: number): void {
  getDb().run(
    'INSERT INTO planned_overlap_decisions (overlap_id, project_root, action, words, by_name, by_type, at) VALUES (?, ?, ?, ?, ?, ?, ?)',
    [overlapId, projectRoot, action, words, by.author, by.authorType, now],
  );
  markDirty();
}

/** Whether `from` waits on `to`, directly or through other tasks. */
function waitsOn(from: string, to: ReadonlySet<string>, seen = new Set<string>()): boolean {
  if (seen.has(from)) return false;
  seen.add(from);
  for (const d of getItem(from)?.dependencies ?? []) {
    if (to.has(d) || waitsOn(d, to, seen)) return true;
  }
  return false;
}

/** The first plan's tasks go first; every other plan's tasks in the overlap wait on them. */
export function resequence(projectRoot: string, overlapId: string, firstPlanUid: string, by: { author: string; authorType: string }, now = Date.now()): { overlap: PlannedOverlap; waiting: Array<{ uid: string; title: string }> } {
  const { overlap } = find(projectRoot, overlapId);
  const first = overlap.plans.find((p) => p.uid === firstPlanUid);
  if (!first) throw new OverlapActionError(400, `That plan is not in this planned overlap. Choose one of: ${overlap.plans.map((p) => p.label).join(', ')}.`);
  const firstTasks = first.tasks.map((t) => t.uid);
  const later = overlap.plans.filter((p) => p.uid !== firstPlanUid).flatMap((p) => p.tasks);
  const laterSet = new Set(later.map((t) => t.uid));
  // A first task already waiting on a later one would wait on itself.
  const loop = firstTasks.find((t) => waitsOn(t, laterSet));
  if (loop) {
    throw new OverlapActionError(409, `${first.label} cannot go first: its task "${getItem(loop)?.title ?? loop}" already waits on the other plan's work, so they would wait on each other.`);
  }
  const waiting: Array<{ uid: string; title: string }> = [];
  for (const t of later) {
    const item = getItem(t.uid);
    if (!item) continue;
    const deps = [...new Set([...(item.dependencies ?? []), ...firstTasks])];
    if (deps.length === (item.dependencies ?? []).length) continue;
    updateItem(item.uid, {
      dependencies: deps,
      author: by.author,
      authorType: by.authorType,
      changeSummary: `Waits on ${first.label} (re-sequenced over a planned overlap on ${overlap.subject})`,
    });
    waiting.push({ uid: item.uid, title: item.title });
  }
  const others = overlap.plans.filter((p) => p.uid !== firstPlanUid).map((p) => p.label).join(', ');
  record(projectRoot, overlapId, 'resequence', `${first.label} goes first; ${others} waits`, by, now);
  return { overlap: find(projectRoot, overlapId).overlap, waiting };
}

/** What a session holding one of these tasks is told. */
function tellText(o: PlannedOverlap, sessionTaskUids: ReadonlySet<string>, by: string): string {
  const mine = o.plans.flatMap((p) => p.tasks.filter((t) => sessionTaskUids.has(t.uid)).map((t) => `"${t.title}" (${p.label})`));
  const theirs = o.plans.flatMap((p) => p.tasks.filter((t) => !sessionTaskUids.has(t.uid)).map((t) => `"${t.title}" in ${p.label}`));
  return [
    '── CodeTrellis: planned overlap ──',
    `${by} asks you to know: ${o.words.replace(/^◇ planned overlap: /, '')}.`,
    theirs.length
      ? `Your ${mine.length === 1 ? 'task' : 'tasks'} ${mine.join(', ')} and ${theirs.join(', ')} both plan to touch ${o.kind === 'material' ? 'it' : o.subject}.`
      : `Your tasks ${mine.join(', ')} all plan to touch ${o.kind === 'material' ? 'it' : o.subject}.`,
    `${o.serious ? 'This one is serious. ' : ''}Agree an order before changing it: get_play_forward shows the plans, and a person can re-sequence them.`,
  ].join('\n');
}

/** Each session holding a task in the overlap is told once, on its next call. */
export function tellAgents(projectRoot: string, overlapId: string, by: { author: string; authorType: string }, now = Date.now()): { told: number; tasksWithoutAgent: string[] } {
  const { overlap } = find(projectRoot, overlapId);
  const bySession = new Map<string, Set<string>>();
  const without: string[] = [];
  for (const p of overlap.plans) {
    for (const t of p.tasks) {
      const session = getItem(t.uid)?.assigneeSession ?? null;
      if (!session) { without.push(t.title); continue; }
      bySession.set(session, (bySession.get(session) ?? new Set()).add(t.uid));
    }
  }
  for (const [session, taskUids] of bySession) {
    getDb().run(
      `INSERT INTO planned_overlap_tells (overlap_id, session_id, text, created_at, read_at) VALUES (?, ?, ?, ?, NULL)
       ON CONFLICT(overlap_id, session_id) DO UPDATE SET text = excluded.text, created_at = excluded.created_at, read_at = NULL`,
      [overlapId, session, tellText(overlap, taskUids, by.author), now],
    );
  }
  const n = bySession.size;
  record(projectRoot, overlapId, 'tell',
    n === 0 ? 'No agent holds these tasks yet: nobody was told'
      : `Told ${n} ${n === 1 ? 'agent' : 'agents'}${without.length ? `; ${without.length} ${without.length === 1 ? 'task has' : 'tasks have'} no agent yet` : ''}`,
    by, now);
  return { told: n, tasksWithoutAgent: without };
}

/** Kept as it is: drawn quieter, with who chose that. */
export function leaveOverlap(projectRoot: string, overlapId: string, by: { author: string; authorType: string }, now = Date.now()): void {
  find(projectRoot, overlapId);
  record(projectRoot, overlapId, 'leave', `Left as it is by ${by.author}`, by, now);
}

/**
 * What this session should be told about planned overlaps, once, or null.
 * Never throws: a notice must not break the tool call it rides on.
 */
export function plannedOverlapNoticeFor(sessionId: string, now = Date.now()): string | null {
  try {
    const unread = rows('SELECT overlap_id, text FROM planned_overlap_tells WHERE session_id = ? AND read_at IS NULL ORDER BY created_at', [sessionId]);
    if (unread.length === 0) return null;
    getDb().run('UPDATE planned_overlap_tells SET read_at = ? WHERE session_id = ? AND read_at IS NULL', [now, sessionId]);
    markDirty();
    return unread.map((r) => String(r[1])).join('\n\n');
  } catch (err) {
    console.warn('[PlayForward] planned overlap notice failed:', err instanceof Error ? err.message : err);
    return null;
  }
}

// ── B9.3b: said when a plan is approved ─────────────────────────────

export interface ApprovalNotice {
  id: number;
  planUid: string;
  planLabel: string;
  /** "Approving JIRA-150 puts it in 1 planned overlap" */
  title: string;
  /** Each open planned overlap's words. */
  overlaps: string[];
  at: number;
}

/**
 * A plan was approved (G3's question): the planned overlaps it is in that
 * nobody has dealt with (not sequenced, not left) are said in the
 * approval's answer and, once, in the inbox. Nothing is said when there are
 * none. Never throws: an approval must not fail on a notice.
 */
export function noteApproval(projectRoot: string, planUid: string, now = Date.now()): { overlaps: string[]; noticeId: number | null } {
  try {
    const forward = buildPlayForward(projectRoot);
    const label = forward.plans.find((p) => p.uid === planUid)?.label ?? planUid;
    const open = forward.overlaps.filter((o) => !o.sequenced && !o.left && o.plans.some((p) => p.uid === planUid));
    if (open.length === 0) return { overlaps: [], noticeId: null };
    const words = open.map((o) => o.words);
    getDb().run(
      'INSERT INTO planned_overlap_notices (project_root, plan_uid, plan_label, words_json, at) VALUES (?, ?, ?, ?, ?)',
      [projectRoot, planUid, label, JSON.stringify(words), now],
    );
    const id = Number(rows('SELECT MAX(id) FROM planned_overlap_notices')[0]?.[0] ?? 0);
    markDirty();
    return { overlaps: words, noticeId: id };
  } catch (err) {
    console.warn('[PlayForward] approval notice failed:', err instanceof Error ? err.message : err);
    return { overlaps: [], noticeId: null };
  }
}

const noticeTitle = (label: string, n: number) => `Approving ${label} puts it in ${n === 1 ? 'a planned overlap' : `${n} planned overlaps`}`;

/** The inbox's notices not yet seen, newest first. */
export function approvalNotices(projectRoot: string): ApprovalNotice[] {
  return rows(
    'SELECT id, plan_uid, plan_label, words_json, at FROM planned_overlap_notices WHERE project_root = ? AND seen_at IS NULL ORDER BY at DESC, id DESC',
    [projectRoot],
  ).map((r) => {
    let overlaps: string[] = [];
    try { overlaps = JSON.parse(String(r[3])) as string[]; } catch { /* kept empty */ }
    return { id: Number(r[0]), planUid: String(r[1]), planLabel: String(r[2]), title: noticeTitle(String(r[2]), overlaps.length), overlaps, at: Number(r[4]) };
  });
}

/** Seen: it leaves the inbox. */
export function markNoticeSeen(projectRoot: string, id: number, by: { author: string }, now = Date.now()): boolean {
  const open = rows('SELECT 1 FROM planned_overlap_notices WHERE id = ? AND project_root = ? AND seen_at IS NULL', [id, projectRoot]).length > 0;
  if (!open) return false;
  getDb().run('UPDATE planned_overlap_notices SET seen_at = ?, seen_by = ? WHERE id = ?', [now, by.author, id]);
  markDirty();
  return true;
}
