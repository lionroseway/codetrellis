/**
 * Teammates' material reads (Phase 32 C3.5; the owner's choice: shared by
 * default once a folder is shared).
 *
 * A6's material signals compare which version of a file each task read,
 * but only the reads made on this machine were known, so Alex's task working
 * from last week's sales export and Sam replacing it were never put side by
 * side. With task state shared (C3.1), each app also writes which version of
 * each material its tasks read, as records in the plans folder
 * (`read-record.ts`), and reads its teammates':
 *
 *  - **A separate switch, on by default.** No row means on whenever the
 *    project shares task state; the person can turn it off here and back on.
 *    Turning it on is theirs (the grant rule); off is anyone's. Off, nothing
 *    is written and teammates' reads are forgotten here, so no signal rests
 *    on them; they are read again if it is turned back on.
 *  - **A record per version, not per read.** One is written when a task reads
 *    a version of a material its last record here did not name.
 *  - **Signed and checked** as task-state records are (C3.3). An unverified
 *    read still counts, and says so wherever the reader is named.
 *  - **Untrusted input**: read through the confined helper, never through a
 *    link or a placeholder (C3.4b), size and count limited; a folder must be
 *    a task this machine has, in that plan of that project.
 */

import fs from 'node:fs';
import path from 'node:path';
import { getDb } from '../database';
import { markDirty } from '../persistence';
import { readTextWithin, writeFileWithin } from '../confined-fs';
import { isPlaceholder } from '../cloud-files';
import { getPlan } from '../plan-service';
import { getItem } from '../plan-item-service';
import { isRecordId } from './record';
import { parseReadRecord, readRecordBytes, serializeReadRecord, type ReadRecord } from './read-record';
import { checkContext, signRecord, verifyTaskRecord, type CheckContext } from './trust';

export const READS_DIR = path.join('.codetrellis', 'reads');
const MAX_FILES_PER_ITEM = 5_000;
const FILE = /^([a-f0-9]{8,32})-(\d{1,9})\.yaml$/;

// ── The switch ───────────────────────────────────────────────────────────

export interface MaterialReadsChoice {
  /** Whether reads are shared here, given whether task state is. */
  enabled: boolean;
  /** False while nobody has chosen: the default applies. */
  chosen: boolean;
  changedAt: number | null;
  changedBy: string | null;
}

export function materialReadsChoice(projectRoot: string, sharingTaskState: boolean): MaterialReadsChoice {
  const v = getDb().exec('SELECT enabled, changed_at, changed_by FROM shared_material_reads WHERE project_root = ?', [projectRoot])[0]?.values[0];
  const chosenOn = v ? Number(v[0]) === 1 : true;
  return {
    enabled: sharingTaskState && chosenOn,
    chosen: !!v,
    changedAt: v ? Number(v[1]) : null,
    changedBy: v ? String(v[2]) : null,
  };
}

export function setMaterialReadsChoice(projectRoot: string, enabled: boolean, by: string): void {
  getDb().run(
    `INSERT INTO shared_material_reads (project_root, enabled, changed_at, changed_by) VALUES (?, ?, ?, ?)
     ON CONFLICT(project_root) DO UPDATE SET enabled = excluded.enabled, changed_at = excluded.changed_at, changed_by = excluded.changed_by`,
    [projectRoot, enabled ? 1 : 0, Date.now(), by],
  );
  markDirty();
}

/** Forget every teammate's read of this project's tasks: sharing them was turned off. */
export function forgetTeammateReads(projectRoot: string): number {
  const trimmed = projectRoot.replace(/[\\/]+$/, '');
  const before = getDb().exec('SELECT COUNT(*) FROM teammate_material_reads')[0]?.values[0]?.[0];
  getDb().run(
    'DELETE FROM teammate_material_reads WHERE plan_uid IN (SELECT uid FROM plans WHERE project_path = ? OR project_path = ?)',
    [projectRoot, trimmed],
  );
  const after = getDb().exec('SELECT COUNT(*) FROM teammate_material_reads')[0]?.values[0]?.[0];
  const gone = Number(before ?? 0) - Number(after ?? 0);
  if (gone) markDirty();
  return gone;
}

/** Forget one device's reads everywhere, so they are checked again (its key was trusted or refused). */
export function forgetReadsBy(writer: string): void {
  getDb().run('DELETE FROM teammate_material_reads WHERE writer = ?', [writer]);
  markDirty();
}

// ── Writing ──────────────────────────────────────────────────────────────

export interface Writer { me: string; name: string }

function filesIn(dir: string): string[] {
  try {
    return fs.readdirSync(dir, { withFileTypes: true })
      .filter((e) => e.isFile() && FILE.test(e.name))
      .map((e) => e.name)
      .slice(0, MAX_FILES_PER_ITEM);
  } catch { return []; }
}

function readFile(home: string, dir: string, name: string, where: { plan: string; item: string }) {
  const file = path.join(dir, name);
  if (isPlaceholder(file)) return null; // still in the cloud (C3.4b)
  let text: string;
  try { text = readTextWithin(home, file, 'material-read record'); } catch { return null; }
  const parsed = parseReadRecord(text, where);
  if (!('record' in parsed)) return null;
  // The file's name is the record's writer and counter: a copy under another name is not read.
  const m = FILE.exec(name)!;
  if (parsed.record.writer !== m[1] || parsed.record.counter !== Number(m[2])) return null;
  return parsed;
}

/**
 * Write this device's record of a task reading a version of a material,
 * unless its latest record for that material already names this version.
 * Returns the file written, or null when there was nothing new to say.
 */
export function writeReadRecord(
  where: { projectRoot: string; home: string } & Writer,
  read: { plan: string; item: string; by: { author: string; authorType: string }; material: string; attachment: string | null; sha256: string | null },
  now = Date.now(),
): string | null {
  if (!isRecordId(read.plan) || !isRecordId(read.item)) return null;
  const dir = path.join(where.home, READS_DIR, read.plan, read.item);
  const mine = filesIn(dir)
    .map((name) => ({ name, counter: Number(FILE.exec(name)![2]), writer: FILE.exec(name)![1] }))
    .filter((f) => f.writer === where.me)
    .sort((a, b) => b.counter - a.counter);
  for (const f of mine) {
    const r = readFile(where.home, dir, f.name, read)?.record;
    if (r?.material !== read.material) continue;
    if (r.sha256 === read.sha256) return null;
    break;
  }
  let counter = (mine[0]?.counter ?? 0) + 1;
  while (fs.existsSync(path.join(dir, `${where.me}-${counter}.yaml`))) counter++;
  const record: ReadRecord = {
    writer: where.me, name: where.name, counter, at: now, plan: read.plan, item: read.item,
    by: read.by, material: read.material, attachment: read.attachment, sha256: read.sha256,
  };
  const signature = signRecord(where.projectRoot, where.home, record, readRecordBytes(record));
  return writeFileWithin(where.home, path.join(dir, `${where.me}-${counter}.yaml`), serializeReadRecord(record, signature), 'material-read record');
}

// ── Reading teammates' ───────────────────────────────────────────────────

/** Who read it, as people say it: "Sam Lee", or "claude-code for Sam Lee". */
export function readerWords(r: ReadRecord, verifiedAs: string | null): string {
  const who = verifiedAs ?? r.name;
  const person = r.by.authorType === 'human' || r.by.authorType === 'unverified' || r.by.author === r.name;
  return person ? who : `${r.by.author} for ${who}`;
}

/**
 * Read every teammate's read records in a project (or one plan's). A record
 * already read is not read again: one never changes. Returns how many were new.
 */
export function readTeammateReads(projectRoot: string, home: string, me: string, onlyPlan?: string): number {
  const root = path.join(home, READS_DIR);
  const dirs = (d: string) => {
    try { return fs.readdirSync(d, { withFileTypes: true }).filter((e) => e.isDirectory() && isRecordId(e.name)).map((e) => e.name); } catch { return []; }
  };
  const known = (writer: string, item: string, counter: number) =>
    !!getDb().exec('SELECT 1 FROM teammate_material_reads WHERE writer = ? AND item_uid = ? AND counter = ?', [writer, item, counter])[0]?.values[0];
  let ctx: CheckContext | null = null;
  let added = 0;
  for (const plan of dirs(root)) {
    if (onlyPlan && plan !== onlyPlan) continue;
    if (getPlan(plan)?.projectPath !== projectRoot) continue;
    for (const item of dirs(path.join(root, plan))) {
      // Only a task this machine has, in the plan the folder names.
      const it = getItem(item);
      if (!it || it.planUid !== plan) continue;
      const dir = path.join(root, plan, item);
      for (const name of filesIn(dir)) {
        const m = FILE.exec(name)!;
        if (m[1] === me || known(m[1], item, Number(m[2]))) continue;
        const parsed = readFile(home, dir, name, { plan, item });
        if (!parsed) continue;
        const r = parsed.record;
        ctx ??= checkContext(projectRoot);
        const v = verifyTaskRecord(r, parsed.signed, ctx);
        getDb().run(
          `INSERT OR IGNORE INTO teammate_material_reads (writer, item_uid, counter, plan_uid, name, reader, attachment_uid, path, sha256, at, verdict)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [r.writer, item, r.counter, plan, v.verified ? v.who : r.name, readerWords(r, v.verified ? v.who : null), r.attachment, r.material, r.sha256, r.at,
            JSON.stringify(v.verified ? { verified: true, how: v.how, who: v.who } : { verified: false, why: v.why })],
        );
        added++;
      }
    }
  }
  if (added) markDirty();
  return added;
}

/** This device's read records in a project, and teammates' read here, with who. */
export function readCounts(projectRoot: string, home: string | null, me: string): { mine: number; teammates: number; people: string[] } {
  let mine = 0;
  if (home) {
    const root = path.join(home, READS_DIR);
    const dirs = (d: string) => { try { return fs.readdirSync(d, { withFileTypes: true }).filter((e) => e.isDirectory()).map((e) => e.name); } catch { return []; } };
    for (const plan of dirs(root)) for (const item of dirs(path.join(root, plan))) mine += filesIn(path.join(root, plan, item)).filter((n) => n.startsWith(`${me}-`)).length;
  }
  const trimmed = projectRoot.replace(/[\\/]+$/, '');
  const rows = getDb().exec(
    `SELECT name FROM teammate_material_reads WHERE plan_uid IN (SELECT uid FROM plans WHERE project_path = ? OR project_path = ?)`,
    [projectRoot, trimmed],
  )[0]?.values ?? [];
  return { mine, teammates: rows.length, people: [...new Set(rows.map((r) => String(r[0])))].sort() };
}
