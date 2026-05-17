import { randomUUID } from 'node:crypto';
import { getDb } from './database';
import { markDirty } from './persistence';
import type { Comment, CommentType, CommentKind, CommentSource } from '../../shared/types';

/**
 * Phase 14 §A — first-class task chatter.
 *
 * Two parallel taxonomies:
 *   - `commentType` (legacy): 'comment' | 'suggestion' | 'approval' |
 *     'concern' | 'status_update'. Kept so existing plan UI keeps
 *     rendering with its old chips.
 *   - `kind` (new):           'note' | 'blocker' | 'progress' | 'question'.
 *     Drives the per-task comments thread and the activity rail.
 *
 * `source` is `'agent' | 'human'` and `metadata` carries kind-specific
 * extras (today: `{ progressPercent }` for `kind: 'progress'`).
 */
export interface AddCommentOptions {
  /** Legacy `commentType` chip. Defaults to 'comment'. */
  commentType?: CommentType;
  /** Phase 14 §A first-class kind. */
  kind?: CommentKind;
  /** `'agent'` or `'human'`. Defaults inferred from authorType. */
  source?: CommentSource;
  parentUid?: string;
  metadata?: Record<string, unknown>;
}

function inferSource(authorType: string, explicit?: CommentSource): CommentSource {
  if (explicit) return explicit;
  return authorType === 'human' ? 'human' : 'agent';
}

/**
 * Phase 15 §C — `'item'` joins the targetType union as the unified
 * comment target for `plan_items`. Old paths (`'plan'` for plan-
 * scoped comments, `'task'` / `'plan_doc'` retargeted by the
 * 15.B migrator) keep working unchanged.
 */
export type CommentTargetType = 'plan' | 'task' | 'plan_doc' | 'item';

export function addComment(
  targetType: CommentTargetType,
  targetUid: string,
  author: string,
  authorType: string,
  body: string,
  commentTypeOrOpts: CommentType | AddCommentOptions = 'comment',
  parentUidLegacy?: string,
): Comment {
  const opts: AddCommentOptions = typeof commentTypeOrOpts === 'string'
    ? { commentType: commentTypeOrOpts, parentUid: parentUidLegacy }
    : commentTypeOrOpts;

  const uid = randomUUID();
  const now = Date.now();
  const commentType: CommentType = opts.commentType ?? 'comment';
  const kind = opts.kind ?? null;
  const source = inferSource(authorType, opts.source);
  const metadataJson = opts.metadata ? JSON.stringify(opts.metadata) : null;

  getDb().run(
    `INSERT INTO comments (uid, target_type, target_uid, parent_uid, author, author_type, body, comment_type, kind, source, metadata, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [uid, targetType, targetUid, opts.parentUid || null, author, authorType, body, commentType, kind, source, metadataJson, now]
  );

  markDirty();

  return {
    uid, targetType, targetUid, parentUid: opts.parentUid || null,
    author, authorType, body, commentType,
    kind: kind ?? undefined,
    source,
    metadata: opts.metadata,
    createdAt: now,
  };
}

interface CommentRow {
  uid: string;
  targetType: CommentTargetType;
  targetUid: string;
  parentUid: string | null;
  author: string;
  authorType: string;
  body: string;
  commentType: CommentType;
  kind: CommentKind | undefined;
  source: CommentSource | undefined;
  metadata: Record<string, unknown> | undefined;
  createdAt: number;
}

function rowToComment(r: any[]): CommentRow {
  let metadata: Record<string, unknown> | undefined;
  try {
    metadata = r[10] ? JSON.parse(r[10]) : undefined;
  } catch {
    metadata = undefined;
  }
  return {
    uid: r[0], targetType: r[1], targetUid: r[2], parentUid: r[3],
    author: r[4], authorType: r[5], body: r[6], commentType: r[7] as CommentType,
    kind: (r[8] as CommentKind | null) ?? undefined,
    source: (r[9] as CommentSource | null) ?? undefined,
    metadata,
    createdAt: r[11],
  };
}

const COMMENT_COLUMNS = `uid, target_type, target_uid, parent_uid, author, author_type, body, comment_type, kind, source, metadata, created_at`;

/**
 * Delete a comment by uid. Hard delete — comments are conversational
 * and short-lived; we don't keep tombstones. Returns true if a row
 * was removed, false if no such comment.
 */
export function deleteComment(uid: string): boolean {
  const db = getDb();
  const before = db.exec(`SELECT uid FROM comments WHERE uid = ?`, [uid]);
  if (!before[0]?.values[0]) return false;
  db.run(`DELETE FROM comments WHERE uid = ?`, [uid]);
  markDirty();
  return true;
}

export function getComments(targetUid: string): Comment[] {
  const result = getDb().exec(
    `SELECT ${COMMENT_COLUMNS}
     FROM comments WHERE target_uid = ? ORDER BY created_at ASC`,
    [targetUid]
  );
  if (!result[0]) return [];

  const all = result[0].values.map((r: any[]): Comment => ({
    ...rowToComment(r),
    replies: [],
  }));

  // Build threaded structure
  const topLevel: Comment[] = [];
  const byUid = new Map<string, Comment>();
  for (const c of all) {
    byUid.set(c.uid, c);
  }
  for (const c of all) {
    if (c.parentUid && byUid.has(c.parentUid)) {
      byUid.get(c.parentUid)!.replies!.push(c);
    } else {
      topLevel.push(c);
    }
  }

  return topLevel;
}

/**
 * Flat list of all comments on a target (no threading). Used by the
 * activity rail and `read_task_full` so callers can sort/filter by
 * `kind`, `source`, or `createdAt` without hopping the tree.
 */
export function listCommentsFlat(targetUid: string): Comment[] {
  const result = getDb().exec(
    `SELECT ${COMMENT_COLUMNS}
     FROM comments WHERE target_uid = ? ORDER BY created_at ASC`,
    [targetUid],
  );
  if (!result[0]) return [];
  return result[0].values.map((r: any[]): Comment => rowToComment(r));
}

/**
 * Phase 15 §C — comments belonging to a `plan_items` row. Reads any
 * of `'item'` (native) or `'task'` (legacy, pre-migration) so the
 * unified surface keeps showing chatter throughout the cutover.
 */
export function listItemComments(itemUid: string): Comment[] {
  const result = getDb().exec(
    `SELECT ${COMMENT_COLUMNS}
     FROM comments
     WHERE target_uid = ? AND target_type IN ('item', 'task')
     ORDER BY created_at ASC`,
    [itemUid],
  );
  if (!result[0]) return [];
  return result[0].values.map((r: any[]): Comment => rowToComment(r));
}

/**
 * Comments authored since `since` (ms epoch) on either a single task
 * or every task in a plan. Used by `get_drift_report` to surface
 * "comment activity since last check".
 */
export function listCommentsForPlanSince(planUid: string, since: number): Comment[] {
  const db = getDb();
  // Pull task uids for the plan, then fetch comments for any of them.
  const taskRows = db.exec(`SELECT uid FROM tasks WHERE plan_uid = ?`, [planUid]);
  const taskUids: string[] = (taskRows[0]?.values ?? []).map((r: any[]) => r[0] as string);
  if (taskUids.length === 0) return [];
  // Build a parameterised IN clause. SQLite-via-sql.js doesn't support
  // array bindings so we splat the placeholders.
  const placeholders = taskUids.map(() => '?').join(', ');
  const result = db.exec(
    `SELECT ${COMMENT_COLUMNS}
     FROM comments
     WHERE target_uid IN (${placeholders}) AND created_at > ?
     ORDER BY created_at ASC`,
    [...taskUids, since],
  );
  if (!result[0]) return [];
  return result[0].values.map((r: any[]): Comment => rowToComment(r));
}
