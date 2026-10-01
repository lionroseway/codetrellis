/**
 * Task state shared as records in the project's files (Phase 32 C3.1;
 * shared-work doc C-3).
 *
 * C2.4b took state out of the plan's files, so a teammate who pulls sees a
 * plan's tasks but not that Sam's report is in progress. With this switch on,
 * each state change on this machine (status, claim, progress, blocker) is
 * written as a new record, one file, never edited:
 *
 *     .codetrellis/records/<plan uid>/<item uid>/<writer>-<counter>.yaml
 *
 * and every writer's records are read back: a record made having seen this
 * machine's latest is the task's state here too, said as the teammate's and
 * unverified (records are not signed until C3.3). People acting at once is
 * kept, never picked between (C3.2 makes it a signal).
 *
 * The same layout works whether git or a synced folder carries the files:
 * two people acting at once make two files, so there is nothing to merge.
 *
 *  - **Off until turned on**, per project, on this device only: a row in this
 *    device's database, never `.codetrellis/config.json`, which is committed.
 *    Turning it on is the person's (the grant rule); turning it off is anyone's.
 *  - **Records are untrusted input**: read through the confined-file helper,
 *    never through a link, size and count limited, parsed in `record.ts`, and
 *    never a source of a path: folder names are checked to be uids of a plan
 *    and item this machine has, and a record naming another task is not read.
 *  - **Nothing is sent anywhere.** git or the sync client moves the files.
 */

import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import chokidar, { type FSWatcher } from 'chokidar';
import { getDb } from '../database';
import { markDirty } from '../persistence';
import { readTextWithin, writeFileWithin } from '../confined-fs';
import { getSettings, readGitIdentity } from '../settings-service';
import { getPlan } from '../plan-service';
import { applyRecordedState, getItem } from '../plan-item-service';
import { getLinkedPlanDir } from '../plan-file-service';
import type { PlanItem } from '../../../shared/types';
import { headOf, setHead, splitOf } from './heads';
import type { AtOnceClaim } from '../../../shared/lib/item-status';
import {
  distinctRecords, isRecordId, parseRecord, readItem, recordFileName, seenOf, serializeRecord,
  type RecordedState, type TaskRecord,
} from './record';

/** Records read from one item's folder at most: a team writes far fewer. */
const MAX_RECORDS_PER_ITEM = 5_000;

export const RECORDS_DIR = path.join('.codetrellis', 'records');

export interface SharedTaskStateStatus {
  project: string;
  enabled: boolean;
  changedAt: number | null;
  changedBy: string | null;
  /** This device's writer id, as its records name it. */
  writer: string;
  /** The name its records carry: Settings → Identity, else git's user.name. */
  name: string;
  /** Records in the project's files, and how many writers made them. */
  records: number;
  writers: number;
  says: string;
}

// ── The switch ───────────────────────────────────────────────────────────

function rowOf(projectRoot: string): { enabled: boolean; changedAt: number; changedBy: string } | null {
  const v = getDb().exec('SELECT enabled, changed_at, changed_by FROM shared_task_state WHERE project_root = ?', [projectRoot])[0]?.values[0];
  return v ? { enabled: Number(v[0]) === 1, changedAt: Number(v[1]), changedBy: String(v[2]) } : null;
}

export function isSharingTaskState(projectRoot: string): boolean {
  return rowOf(projectRoot)?.enabled === true;
}

/** This device's writer id, made once. */
export function writerId(): string {
  const v = getDb().exec('SELECT writer FROM task_record_writer WHERE id = 1')[0]?.values[0];
  if (v) return String(v[0]);
  const id = crypto.randomBytes(8).toString('hex');
  getDb().run('INSERT OR IGNORE INTO task_record_writer (id, writer) VALUES (1, ?)', [id]);
  markDirty();
  return writerId();
}

function writerName(projectRoot: string): string {
  return getSettings().identity.displayName || readGitIdentity(projectRoot).name || 'someone';
}

function counts(projectRoot: string): { records: number; writers: number } {
  const writers = new Set<string>();
  let records = 0;
  for (const { files } of itemFolders(projectRoot)) {
    for (const f of files) {
      records++;
      const m = /^([a-f0-9]{8,32})-\d+/.exec(f);
      if (m) writers.add(m[1]);
    }
  }
  return { records, writers: writers.size };
}

export function getSharedTaskState(projectRoot: string): SharedTaskStateStatus {
  const row = rowOf(projectRoot);
  const enabled = row?.enabled === true;
  const { records, writers } = counts(projectRoot);
  const name = writerName(projectRoot);
  const found = records ? ` ${records} record${records === 1 ? '' : 's'} from ${writers} ${writers === 1 ? 'device' : 'devices'} are in the project's files.` : '';
  return {
    project: projectRoot,
    enabled,
    changedAt: row?.changedAt ?? null,
    changedBy: row?.changedBy ?? null,
    writer: writerId(),
    name,
    records,
    writers,
    says: enabled
      ? `On: each change to a task's state here is written to ${RECORDS_DIR} as ${name}, and teammates' records are read.${found}`
      : `Off. Task state stays on this device; teammates who pull see the plan, not who is doing what.${found}`,
  };
}

/** Turn sharing on or off for this project, on this device. Turning on reads what is already there. */
export function setSharedTaskState(projectRoot: string, enabled: boolean, by: string): SharedTaskStateStatus {
  getDb().run(
    `INSERT INTO shared_task_state (project_root, enabled, changed_at, changed_by) VALUES (?, ?, ?, ?)
     ON CONFLICT(project_root) DO UPDATE SET enabled = excluded.enabled, changed_at = excluded.changed_at, changed_by = excluded.changed_by`,
    [projectRoot, enabled ? 1 : 0, Date.now(), by],
  );
  markDirty();
  if (enabled) {
    startRecordWatcher(projectRoot);
    readProjectRecords(projectRoot);
  } else {
    stopRecordWatcher(projectRoot);
  }
  return getSharedTaskState(projectRoot);
}

// ── Reading the folders ──────────────────────────────────────────────────

/** Every `<plan>/<item>` folder under the records folder, never through a link. */
function itemFolders(projectRoot: string, onlyPlan?: string): Array<{ plan: string; item: string; dir: string; files: string[] }> {
  const root = path.join(projectRoot, RECORDS_DIR);
  const out: Array<{ plan: string; item: string; dir: string; files: string[] }> = [];
  const dirs = (d: string) => {
    try { return fs.readdirSync(d, { withFileTypes: true }).filter((e) => e.isDirectory() && isRecordId(e.name)).map((e) => e.name); } catch { return []; }
  };
  for (const plan of dirs(root)) {
    if (onlyPlan && plan !== onlyPlan) continue;
    for (const item of dirs(path.join(root, plan))) {
      const dir = path.join(root, plan, item);
      let files: string[] = [];
      try {
        files = fs.readdirSync(dir, { withFileTypes: true })
          .filter((e) => e.isFile() && e.name.endsWith('.yaml') && !e.name.startsWith('.'))
          .map((e) => e.name)
          .slice(0, MAX_RECORDS_PER_ITEM);
      } catch { /* gone meanwhile */ }
      out.push({ plan, item, dir, files });
    }
  }
  return out;
}

/** One item's records. A file that is not a record is skipped, never guessed at. */
function readFolder(projectRoot: string, f: { plan: string; item: string; dir: string; files: string[] }): TaskRecord[] {
  const out: TaskRecord[] = [];
  for (const name of f.files) {
    let text: string;
    try { text = readTextWithin(projectRoot, path.join(f.dir, name), 'task record'); } catch { continue; }
    const parsed = parseRecord(text, { plan: f.plan, item: f.item });
    if ('record' in parsed) out.push(parsed.record);
  }
  return out;
}

function itemFolder(projectRoot: string, planUid: string, itemUid: string) {
  const dir = path.join(projectRoot, RECORDS_DIR, planUid, itemUid);
  return itemFolders(projectRoot, planUid).find((f) => f.item === itemUid) ?? { plan: planUid, item: itemUid, dir, files: [] };
}

// ── The head this machine last took or wrote: heads.ts ───────────────────

let splitListener: ((projectRoot: string) => void) | undefined;
/** Told when a project's splits start or end (the server refreshes its signals then). */
export function setSplitChangedListener(fn: ((projectRoot: string) => void) | undefined): void {
  splitListener = fn;
}
function splitsChanged(projectRoot: string): void {
  try { splitListener?.(projectRoot); } catch (err) { console.warn('[TaskRecords] signal refresh failed:', err); }
}

// ── Writing ──────────────────────────────────────────────────────────────

function stateOf(item: PlanItem): RecordedState {
  return {
    status: item.status ?? null,
    assignee: item.assignee ?? null,
    assigneeType: item.assigneeType ?? null,
    progressPercent: item.progressPercent ?? null,
    blockedReason: item.blockedReason ?? null,
  };
}

/** The project a plan's records go to: the one its files are in, when sharing is on there. */
function sharingRootOf(planUid: string): string | null {
  const plan = getPlan(planUid);
  if (!plan?.projectPath || !path.isAbsolute(plan.projectPath)) return null;
  if (!isSharingTaskState(plan.projectPath)) return null;
  // Only a plan whose files are in the project: a local plan's state stays local.
  if (!getLinkedPlanDir(planUid, plan.projectPath)) return null;
  return plan.projectPath;
}

/**
 * Write this machine's new record for an item whose state just changed here.
 * Its counter follows this device's last; `seen` is everyone else's latest
 * in the folder, which is what orders it after theirs.
 */
export function writeRecordFor(item: PlanItem, by: { author: string; authorType: string }, now = Date.now()): string | null {
  if (!isRecordId(item.planUid) || !isRecordId(item.uid)) return null;
  const root = sharingRootOf(item.planUid);
  if (!root) return null;
  const me = writerId();
  const folder = itemFolder(root, item.planUid, item.uid);
  const existing = readFolder(root, folder);
  const mine = existing.filter((r) => r.writer === me);
  let counter = Math.max(0, ...mine.map((r) => r.counter), ...folder.files.map((f) => (f.startsWith(`${me}-`) ? parseInt(f.slice(me.length + 1), 10) || 0 : 0))) + 1;
  while (fs.existsSync(path.join(folder.dir, recordFileName(me, counter)))) counter++;
  const others = seenOf(existing.filter((r) => r.writer !== me));
  const record: TaskRecord = {
    writer: me, name: writerName(root), counter, seen: others, at: now,
    plan: item.planUid, item: item.uid, by, state: stateOf(item),
  };
  const file = writeFileWithin(root, path.join(folder.dir, recordFileName(me, counter)), serializeRecord(record), 'task record');
  // Made having seen everyone's latest, so it ends a split this machine had (C3.2).
  const ended = !!headOf(item.uid)?.split;
  setHead(item.uid, me, counter, null);
  if (ended) splitsChanged(root);
  return file;
}

/**
 * Settle a task people set two ways at once by keeping this machine's state
 * (C3.2): a new record of it, made having seen theirs, which ends the split
 * here and, once it reaches them, there. Taking a teammate's state is just
 * setting it, which writes a record as any change does.
 */
export function keepMyState(itemUid: string, by: { author: string; authorType: string }): { ok: true; file: string } | { ok: false; status: number; error: string } {
  const item = getItem(itemUid);
  if (!item || item.kind !== 'action') return { ok: false, status: 404, error: 'no such task' };
  if (!splitOf(itemUid)) return { ok: false, status: 409, error: 'Nobody set this task two ways at once, so there is nothing to settle.' };
  const file = writeRecordFor(item, by);
  if (!file) return { ok: false, status: 409, error: 'This project does not share task state, so no record can be written.' };
  return { ok: true, file: path.basename(file) };
}

// ── Reading and taking teammates' state ──────────────────────────────────

/**
 * Who a teammate's record says made the change, as a claim: the person
 * ("Sam Lee"), or the agent working on their machine ("claude-code for Sam
 * Lee"). A person in their window and one over their local API read alike
 * here: the whole record is unverified until it is signed.
 */
function recordAuthor(r: TaskRecord): { author: string; authorType: string } {
  const person = r.by.authorType === 'human' || r.by.authorType === 'unverified' || r.by.author === r.name;
  return { author: person ? r.name : `${r.by.author} for ${r.name}`, authorType: 'record' };
}

export interface ReadResult { read: number; applied: string[]; split: string[] }

const claimOf = (r: TaskRecord, forged = false): AtOnceClaim => ({ name: r.name, status: r.state.status, at: r.at, ...(forged ? { forged: true } : {}) });

/**
 * Read every writer's records in a project (or one plan's), and take each
 * item's settled state when it is a teammate's this machine has not taken.
 * Reading the same records again changes nothing.
 */
export function readProjectRecords(projectRoot: string, onlyPlan?: string, onApplied?: (item: PlanItem) => void): ReadResult {
  const result: ReadResult = { read: 0, applied: [], split: [] };
  if (!isSharingTaskState(projectRoot)) return result;
  const me = writerId();
  let changed = false;
  for (const f of itemFolders(projectRoot, onlyPlan)) {
    const item = getItem(f.item);
    // Only a task this machine has, in the plan the folder names.
    if (!item || item.planUid !== f.plan || item.kind !== 'action') continue;
    if (getPlan(f.plan)?.projectPath !== projectRoot) continue;
    const { records, clashing } = distinctRecords(readFolder(projectRoot, f));
    result.read += records.length;
    const read = readItem(records);
    const known = headOf(item.uid);
    // Two different records under one writer and counter: someone wrote one
    // in another's name. Neither is taken, and both are named (C3.2).
    const claims = clashing.length
      ? clashing.flatMap((c) => [claimOf(records.find((r) => r.writer === c.writer && r.counter === c.counter)!, true), claimOf(c, true)])
      : read.kind === 'split' ? read.heads.map((h) => claimOf(h)) : null;
    if (claims) {
      const split = JSON.stringify(claims);
      if (known?.split !== split) { setHead(item.uid, known?.writer ?? '', known?.counter ?? 0, split); changed = true; }
      result.split.push(item.uid);
      continue;
    }
    if (read.kind !== 'settled') continue;
    const { head } = read;
    if (known && known.writer === head.writer && known.counter === head.counter && !known.split) continue;
    if (known?.split) changed = true;
    setHead(item.uid, head.writer, head.counter, null);
    if (head.writer === me) continue;
    const s = head.state;
    const applied = applyRecordedState(item.uid, {
      status: (s.status ?? 'pending') as PlanItem['status'],
      assignee: s.assignee, assigneeType: s.assigneeType,
      progressPercent: s.progressPercent, blockedReason: s.blockedReason,
    }, recordAuthor(head));
    if (applied) {
      result.applied.push(item.uid);
      onApplied?.(applied);
    }
  }
  if (changed) splitsChanged(projectRoot);
  return result;
}

// ── Watching ─────────────────────────────────────────────────────────────

const watchers = new Map<string, FSWatcher>();
let appliedListener: ((item: PlanItem) => void) | undefined;

/** Told of each item whose state a teammate's record changed (the server broadcasts it). */
export function setRecordAppliedListener(fn: ((item: PlanItem) => void) | undefined): void {
  appliedListener = fn;
}

/** Read the project's records, telling the listener of what changed. */
export function readAndTell(projectRoot: string, onlyPlan?: string): ReadResult {
  return readProjectRecords(projectRoot, onlyPlan, appliedListener);
}

/** Watch a project's records folder while sharing is on: a pull or a sync lands files. */
export function startRecordWatcher(projectRoot: string): void {
  if (watchers.has(projectRoot) || !isSharingTaskState(projectRoot)) return;
  const dir = path.join(projectRoot, RECORDS_DIR);
  try { fs.mkdirSync(dir, { recursive: true }); } catch { return; }
  let timer: NodeJS.Timeout | null = null;
  const watcher = chokidar.watch(dir, {
    ignoreInitial: true, persistent: true, depth: 3, followSymlinks: false,
    awaitWriteFinish: { stabilityThreshold: 100, pollInterval: 50 },
  });
  watcher.on('all', (event, file) => {
    if ((event !== 'add' && event !== 'change') || !file?.endsWith('.yaml')) return;
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => {
      timer = null;
      try { readAndTell(projectRoot); } catch (err) { console.warn('[TaskRecords] read failed:', err); }
    }, 150);
  });
  watcher.on('error', (err) => console.warn('[TaskRecords] watcher error:', err));
  watchers.set(projectRoot, watcher);
}

export function stopRecordWatcher(projectRoot: string): void {
  const w = watchers.get(projectRoot);
  if (!w) return;
  watchers.delete(projectRoot);
  void w.close();
}
