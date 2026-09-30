/**
 * Phase 32 B7.5b — legacy plan documents are guarded like pages.
 *
 * A page (an Object item) is changed through `update_item`, which a spec
 * breakpoint holds before it acts. A plan document has no such call: an
 * agent changes one by editing the plan's files on disk, and nothing can
 * pause an editor. So the guard sits where the file comes back in: when the
 * import would change a document a person guards, the app keeps its own
 * version and raises a hit ("changed on disk") with the file's version kept
 * beside it. Continue applies the file's version, as the person; stop keeps
 * the app's, and the next export writes it back over the file.
 *
 * Who edited the file cannot be told, so the hit names no agent.
 */

import { randomBytes } from 'node:crypto';
import { getDb } from './database';
import { markDirty } from './persistence';
import { docBreakpoint, getHit, hitPayload, rowsOf } from './breakpoint-service';
import { recordBreakpointEvent } from './agent-event-log';
import { pushForBreakpoint } from './push-notification-service';
import { getPlanDocument, updatePlanDocument } from './plan-documents-service';
import type { BreakpointHit } from '../../shared/types';

export const DISK_TOOL = 'plan-file';

/** The waiting hit for a document changed on disk, if there is one. */
function waitingHold(docUid: string): string | null {
  return rowsOf<{ ref: string }>(
    `SELECT ref FROM breakpoint_hits WHERE item_uid = ? AND action = 'disk' AND answered_at IS NULL ORDER BY hit_at LIMIT 1`,
    [docUid],
  )[0]?.ref ?? null;
}

/**
 * Whether the file's version of a document may be applied. `held` when a
 * spec breakpoint guards it and the file differs from the app's version: the
 * file's version is kept for the person, and the caller leaves the document
 * alone. A second change while one waits updates the version kept, so the
 * person decides on the file as it is now.
 */
export function guardDiskEdit(docUid: string, incoming: { title?: string; body: string }, now = Date.now()): 'pass' | 'held' {
  const doc = getPlanDocument(docUid);
  if (!doc) return 'pass';
  const title = incoming.title ?? doc.title;
  if (title === doc.title && incoming.body === doc.body) return 'pass';
  const bp = docBreakpoint(docUid);
  if (!bp) return 'pass';

  const db = getDb();
  const open = waitingHold(docUid);
  if (open) {
    db.run('UPDATE plan_doc_disk_holds SET title = ?, body = ?, updated_at = ? WHERE ref = ?', [title, incoming.body, now, open]);
    markDirty();
    return 'held';
  }
  const ref = `bp-${randomBytes(5).toString('hex')}`;
  db.run(
    `INSERT INTO breakpoint_hits (ref, breakpoint_id, tool, action, item_uid, plan_uid, agent, session_id, workstream_root, hit_at)
     VALUES (?, ?, ?, 'disk', ?, ?, NULL, NULL, NULL, ?)`,
    [ref, bp.id, DISK_TOOL, docUid, doc.planUid, now],
  );
  db.run(
    'INSERT INTO plan_doc_disk_holds (ref, doc_uid, title, body, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)',
    [ref, docUid, title, incoming.body, now, now],
  );
  markDirty();
  const hit = getHit(ref)!;
  recordBreakpointEvent('breakpoint_hit', { ...hitPayload(hit), breakpointId: bp.id, on: bp.target, onTitle: bp.targetTitle }, null);
  void pushForBreakpoint(hit).catch(() => {}); // a person away from the desk is told (B4.4)
  return 'held';
}

/**
 * Settle an answered disk hold. Continue (or steer) applies the file's
 * version as the person who decided; stop keeps the app's and returns
 * `restore`, so the caller writes the plan's files again.
 */
export function settleDiskHold(hit: BreakpointHit): 'applied' | 'restore' | null {
  if (hit.action !== 'disk' || hit.answeredAt === null) return null;
  const held = rowsOf<{ title: string; body: string }>('SELECT title, body FROM plan_doc_disk_holds WHERE ref = ?', [hit.ref])[0];
  getDb().run('DELETE FROM plan_doc_disk_holds WHERE ref = ?', [hit.ref]);
  markDirty();
  if (hit.decision === 'stop' || !held) return 'restore';
  const doc = updatePlanDocument(hit.itemUid, {
    title: held.title,
    body: held.body,
    changeSummary: 'The file\'s version, applied from disk when a person continued at the breakpoint',
    author: hit.answeredBy ?? undefined,
    authorType: hit.answeredByType ?? undefined,
  });
  return doc ? 'applied' : 'restore';
}
