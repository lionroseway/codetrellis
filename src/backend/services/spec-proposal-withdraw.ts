/**
 * Phase 32 B7.4 — a proposal whose page is gone cannot be decided.
 *
 * When a page is deleted, or the plan holding it is deleted, its open
 * proposals are withdrawn and their inbox entries answered, so nothing waits
 * on a person for a page that no longer exists. Kept apart from
 * `spec-proposals-service` so `plan-item-service`, which that service
 * imports, can call it too.
 */
import { getDb } from './database';
import { markDirty } from './persistence';

/** Withdraw the open proposals on these pages, or on every page of this plan. Returns how many. */
export function withdrawProposals(scope: { pageUids?: string[]; planUid?: string }, reason: string, now = Date.now()): number {
  const where = scope.planUid
    ? { sql: 'plan_uid = ?', params: [scope.planUid] }
    : scope.pageUids?.length
      ? { sql: `page_uid IN (${scope.pageUids.map(() => '?').join(',')})`, params: scope.pageUids }
      : null;
  if (!where) return 0;
  const db = getDb();
  const open = (db.exec(`SELECT uid, hit_ref FROM spec_proposals WHERE status = 'open' AND ${where.sql}`, where.params)[0]?.values ?? []) as Array<[string, string | null]>;
  for (const [uid, ref] of open) {
    db.run(
      `UPDATE spec_proposals SET status = 'withdrawn', decided_at = ?, decided_by = 'CodeTrellis', decided_by_type = 'system', decision_note = ? WHERE uid = ?`,
      [now, reason, uid],
    );
    if (ref) {
      db.run(
        `UPDATE breakpoint_hits SET decision = 'stop', note = ?, answered_at = ?, answered_by = 'CodeTrellis', answered_by_type = 'system'
          WHERE ref = ? AND answered_at IS NULL`,
        [reason, now, ref],
      );
    }
    db.run(`UPDATE breakpoints SET cleared_at = ?, cleared_by = 'CodeTrellis', cleared_by_type = 'system' WHERE kind = 'proposal' AND target = ? AND cleared_at IS NULL`, [now, uid]);
  }
  if (open.length) markDirty();
  return open.length;
}
