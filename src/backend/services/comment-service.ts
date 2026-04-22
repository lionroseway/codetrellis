import { randomUUID } from 'node:crypto';
import { getDb } from './database';
import { markDirty } from './persistence';
import type { Comment, CommentType } from '../../shared/types';

export function addComment(
  targetType: 'plan' | 'task',
  targetUid: string,
  author: string,
  authorType: string,
  body: string,
  commentType: CommentType = 'comment',
  parentUid?: string,
): Comment {
  const uid = randomUUID();
  const now = Date.now();

  getDb().run(
    `INSERT INTO comments (uid, target_type, target_uid, parent_uid, author, author_type, body, comment_type, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [uid, targetType, targetUid, parentUid || null, author, authorType, body, commentType, now]
  );

  markDirty();

  return {
    uid, targetType, targetUid, parentUid: parentUid || null,
    author, authorType, body, commentType, createdAt: now,
  };
}

export function getComments(targetUid: string): Comment[] {
  const result = getDb().exec(
    `SELECT uid, target_type, target_uid, parent_uid, author, author_type, body, comment_type, created_at
     FROM comments WHERE target_uid = ? ORDER BY created_at ASC`,
    [targetUid]
  );
  if (!result[0]) return [];

  const all = result[0].values.map((r: any[]): Comment => ({
    uid: r[0], targetType: r[1], targetUid: r[2], parentUid: r[3],
    author: r[4], authorType: r[5], body: r[6], commentType: r[7] as CommentType,
    createdAt: r[8],
  }));

  // Build threaded structure
  const topLevel: Comment[] = [];
  const byUid = new Map<string, Comment>();
  for (const c of all) {
    c.replies = [];
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
