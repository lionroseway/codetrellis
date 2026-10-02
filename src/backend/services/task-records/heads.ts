/**
 * Per item, the task-state record this machine last took or wrote, and the
 * people who set it two ways at once (Phase 32 C3.1, C3.2). Only the
 * database: the signal engine and the status view read it without pulling
 * in the record files' reader.
 */

import { getDb } from '../database';
import { markDirty } from '../persistence';
import type { AtOnceClaim, RecordCheck } from '../../../shared/lib/item-status';

export function headOf(itemUid: string): { writer: string; counter: number; split: string | null } | null {
  const v = getDb().exec('SELECT writer, counter, split FROM task_record_heads WHERE item_uid = ?', [itemUid])[0]?.values[0];
  return v ? { writer: String(v[0]), counter: Number(v[1]), split: (v[2] as string | null) ?? null } : null;
}

/** `check`: whether a teammate's record taken here verified (C3.3); null for this machine's own or a split. */
export function setHead(itemUid: string, writer: string, counter: number, split: string | null, check: RecordCheck | null = null): void {
  getDb().run(
    `INSERT INTO task_record_heads (item_uid, writer, counter, split, verdict) VALUES (?, ?, ?, ?, ?)
     ON CONFLICT(item_uid) DO UPDATE SET writer = excluded.writer, counter = excluded.counter, split = excluded.split, verdict = excluded.verdict`,
    [itemUid, writer, counter, split, check ? JSON.stringify(check) : null],
  );
  markDirty();
}

/** Check a head again (a key was trusted or refused since): only its verdict changes. */
export function setHeadCheck(itemUid: string, check: RecordCheck): void {
  getDb().run('UPDATE task_record_heads SET verdict = ? WHERE item_uid = ?', [JSON.stringify(check), itemUid]);
  markDirty();
}

/** Every item whose state a teammate's record set here, with whether it verified. */
export function allHeadChecks(): Map<string, RecordCheck> {
  const out = new Map<string, RecordCheck>();
  for (const r of getDb().exec('SELECT item_uid, verdict FROM task_record_heads WHERE verdict IS NOT NULL')[0]?.values ?? []) {
    try { out.set(String(r[0]), JSON.parse(String(r[1])) as RecordCheck); } catch { /* unreadable: skipped */ }
  }
  return out;
}

/** The heads a writer's records set here: rechecked when its key is trusted or refused. */
export function headsBy(writer: string): Array<{ itemUid: string; counter: number }> {
  return (getDb().exec('SELECT item_uid, counter FROM task_record_heads WHERE writer = ? AND split IS NULL AND verdict IS NOT NULL', [writer])[0]?.values ?? [])
    .map((r) => ({ itemUid: String(r[0]), counter: Number(r[1]) }));
}

/**
 * People who set this item two ways at once, as last read: who, and what
 * each said (C3.2). `forged` marks two different records under one writer
 * and counter, which no honest writer makes.
 */
export function splitOf(itemUid: string): AtOnceClaim[] | null {
  const s = headOf(itemUid)?.split;
  if (!s) return null;
  try { return JSON.parse(s) as AtOnceClaim[]; } catch { return null; }
}

/** Every item this machine has a split for, with its claims. */
export function allSplits(): Map<string, AtOnceClaim[]> {
  const out = new Map<string, AtOnceClaim[]>();
  for (const r of getDb().exec('SELECT item_uid, split FROM task_record_heads WHERE split IS NOT NULL')[0]?.values ?? []) {
    try { out.set(String(r[0]), JSON.parse(String(r[1])) as AtOnceClaim[]); } catch { /* unreadable: skipped */ }
  }
  return out;
}
