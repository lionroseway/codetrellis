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
 * machine's latest is the task's state here too, said as the teammate's. Each
 * record is signed when written and checked when read (C3.3, `trust.ts`): one
 * that verifies says whose key signed it, any other reads "unverified".
 * People acting at once is kept, never picked between (C3.2 makes it a
 * signal).
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
import { plansHome } from '../plans-home';
import type { PlanItem } from '../../../shared/types';
import { headOf, headsBy, setHead, setHeadCheck, splitOf } from './heads';
import type { AtOnceClaim, RecordCheck } from '../../../shared/lib/item-status';
import { isPlaceholder } from '../cloud-files';
import {
  distinctRecords, isRecordId, parseRecord, readItem, recordBytes, recordFileName, seenOf, serializeRecord,
  type RecordedState, type SignedPart, type TaskRecord,
} from './record';
import {
  forgetReadsBy, forgetTeammateReads, materialReadsChoice, readCounts, readTeammateReads, READS_DIR, setMaterialReadsChoice, writeReadRecord,
  type MaterialReadsChoice,
} from './material-reads';
import { myRunCount, readTeammateRuns, RUNS_DIR, writeRunRecord } from './test-runs';
import { forgetTeammateRuns, listTeammateRuns } from '../tests/teammate-runs';
import { setReportListener } from '../tests/test-results';
import { readTeammateCheckRuns, writeCheckRunRecord } from './check-runs';
import { forgetTeammateCheckRuns, setCheckRunListener } from '../check-runs';
import {
  checkContext, decideKey, listTeammateKeys, readKeyIntroductions, signRecord, signingWay, verifyTaskRecord,
  type CheckContext, type SigningWay, type TeammateKey, type Verdict,
} from './trust';

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
  /** How records written here are signed (C3.3). */
  signing: SigningWay;
  /** Teammates' device keys introduced in this project, and whether each is trusted. */
  keys: TeammateKey[];
  /** Teammates' records, by whether they verified, and why the others did not. */
  checked: { verified: number; unverified: number; reasons: Array<{ why: string; records: number }> };
  /** Teammates' material reads (C3.5): on by default while task state is shared. */
  materialReads: MaterialReadsChoice & { mine: number; teammates: number; people: string[]; says: string };
  /** D1.5a: test runs shared with task state: this device's latest, and each teammate's read here. */
  runs: { mine: number; teammates: Array<{ who: string; verified: boolean; at: number; commit: string | null; tests: number; failing: number }>; says: string };
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

export function writerName(projectRoot: string): string {
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

/** Teammates' records in the project, checked: how many verified, and why the rest did not. */
function checkedCounts(projectRoot: string): SharedTaskStateStatus['checked'] {
  const me = writerId();
  const ctx = checkContext(projectRoot);
  let verified = 0;
  const reasons = new Map<string, number>();
  const home = plansHome(projectRoot);
  for (const f of home ? itemFolders(projectRoot) : []) {
    for (const r of readFolder(home!, f)) {
      if (r.writer === me) continue;
      const v = verifyTaskRecord(r, signedOf(r), ctx);
      if (v.verified) verified++;
      else reasons.set(v.why, (reasons.get(v.why) ?? 0) + 1);
    }
  }
  const list = [...reasons].map(([why, n]) => ({ why, records: n })).sort((a, b) => b.records - a.records);
  return { verified, unverified: list.reduce((t, r) => t + r.records, 0), reasons: list };
}

export function getSharedTaskState(projectRoot: string): SharedTaskStateStatus {
  const row = rowOf(projectRoot);
  const enabled = row?.enabled === true;
  const { records, writers } = counts(projectRoot);
  const name = writerName(projectRoot);
  // Introductions are read whether or not sharing is on, so the person can
  // see who has introduced a key before choosing to share.
  const home = plansHome(projectRoot);
  if (home) readKeyIntroductions(home, writerId());
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
    signing: signingWay(projectRoot),
    // Introduced where the records go: the project, or its linked plans folder.
    keys: listTeammateKeys(home && home !== projectRoot ? [projectRoot, home] : [projectRoot]),
    checked: checkedCounts(projectRoot),
    materialReads: materialReadsStatus(projectRoot, enabled, home),
    runs: runsStatus(projectRoot, enabled, home),
  };
}

function runsStatus(projectRoot: string, sharing: boolean, home: string | null): SharedTaskStateStatus['runs'] {
  const teammates = listTeammateRuns(projectRoot).map((r) => ({
    who: r.who, verified: r.verified, at: r.at, commit: r.commit, tests: r.totals.tests, failing: r.totals.failed + r.totals.errors,
  }));
  const from = teammates.length ? ` Runs from ${[...new Set(teammates.map((t) => t.who))].join(', ')} are here.` : '';
  return {
    mine: myRunCount(home, writerId()),
    teammates,
    says: sharing
      ? `On with task state: each test run reported here is written to ${RUNS_DIR}, and teammates' runs ground your files by the commit they ran on.${from}`
      : 'Shared with task state: turn that on first.',
  };
}

// D1.5a: a new run reported here is shared where task state is.
setReportListener((run) => {
  if (!isSharingTaskState(run.projectRoot)) return;
  const home = plansHome(run.projectRoot);
  if (!home) return;
  writeRunRecord({ projectRoot: run.projectRoot, home, me: writerId(), name: writerName(run.projectRoot) }, run);
});

// Phase 33 C7: so is a check run made here.
setCheckRunListener((run) => {
  if (!isSharingTaskState(run.projectRoot)) return;
  const home = plansHome(run.projectRoot);
  if (!home) return;
  writeCheckRunRecord({ projectRoot: run.projectRoot, home, me: writerId(), name: writerName(run.projectRoot) }, run);
});

function materialReadsStatus(projectRoot: string, sharing: boolean, home: string | null): SharedTaskStateStatus['materialReads'] {
  const choice = materialReadsChoice(projectRoot, sharing);
  const n = readCounts(projectRoot, home, writerId());
  const people = n.people.length ? n.people.join(', ') : null;
  const says = !sharing
    ? 'Shared with task state: turn that on first.'
    : !choice.enabled
      ? 'Off: which version of each material your tasks read stays on this device, and teammates\' reads are not used.'
      : `On: which version of each material your tasks read is written to ${READS_DIR}, and teammates' reads are compared with yours.${people ? ` Reads from ${people} are here.` : ''}`;
  return { ...choice, ...n, says };
}

/** Whether a project's tasks' material reads are shared (C3.5). */
export function isSharingMaterialReads(projectRoot: string): boolean {
  return materialReadsChoice(projectRoot, isSharingTaskState(projectRoot)).enabled;
}

/**
 * Turn sharing material reads on or off for a project, on this device. Off
 * forgets teammates' reads here, so no signal rests on them; on reads them.
 * The caller checks that turning it on is the person's.
 */
export function setSharedMaterialReads(projectRoot: string, enabled: boolean, by: string): SharedTaskStateStatus {
  setMaterialReadsChoice(projectRoot, enabled, by);
  if (!enabled) forgetTeammateReads(projectRoot);
  else {
    const home = plansHome(projectRoot);
    if (home && isSharingTaskState(projectRoot)) readTeammateReads(projectRoot, home, writerId());
  }
  splitsChanged(projectRoot);
  return getSharedTaskState(projectRoot);
}

/**
 * Write this device's record of a task reading a material (C3.5), when its
 * project shares material reads: which file, as stored, and which version.
 */
export function shareMaterialRead(itemUid: string, attachmentUid: string, by: { author: string; authorType: string }): string | null {
  const item = getItem(itemUid);
  if (!item) return null;
  const root = sharingRootOf(item.planUid);
  if (!root || !isSharingMaterialReads(root)) return null;
  const home = plansHome(root);
  if (!home) return null;
  const att = getDb().exec('SELECT value, sha256, kind FROM attachments WHERE uid = ?', [attachmentUid])[0]?.values[0];
  if (!att || String(att[2]) !== 'file_ref') return null;
  try {
    return writeReadRecord(
      { projectRoot: root, home, me: writerId(), name: writerName(root) },
      { plan: item.planUid, item: item.uid, by, material: String(att[0]), attachment: attachmentUid, sha256: att[1] == null ? null : String(att[1]) },
    );
  } catch (err) {
    console.warn('[TaskRecords] could not write a material-read record:', (err as Error).message);
    return null;
  }
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
    void startRecordWatcher(projectRoot);
    readProjectRecords(projectRoot);
  } else {
    stopRecordWatcher(projectRoot);
    // Teammates' reads came with sharing (C3.5): no signal rests on them now.
    if (forgetTeammateReads(projectRoot)) splitsChanged(projectRoot);
    // And their test runs (D1.5a): nothing here is grounded on them now.
    if (forgetTeammateRuns({ projectRoot })) runsChanged(projectRoot);
    // And their check runs (Phase 33 C7).
    if (forgetTeammateCheckRuns({ projectRoot })) checkRunsChanged(projectRoot);
  }
  return getSharedTaskState(projectRoot);
}

// ── Reading the folders ──────────────────────────────────────────────────

/** Every `<plan>/<item>` folder under the records folder, never through a link. */
function itemFolders(projectRoot: string, onlyPlan?: string): Array<{ plan: string; item: string; dir: string; files: string[] }> {
  // The project's plans folder on this device (C3.4a): the project, or the
  // folder it links. None when it names one not linked here.
  const home = plansHome(projectRoot);
  if (!home) return [];
  const root = path.join(home, RECORDS_DIR);
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

/** What each record read says of its signature, beside the record. */
const signedParts = new WeakMap<TaskRecord, SignedPart>();
const UNSIGNED: SignedPart = { bytes: '', signature: null };
const signedOf = (r: TaskRecord): SignedPart => signedParts.get(r) ?? UNSIGNED;

/** One record file, or null when it is not one. `home` is the folder the records sit under. */
function readOne(home: string, f: { plan: string; item: string; dir: string }, name: string): TaskRecord | null {
  // A record a sync client has not brought down is never opened (C3.4b):
  // its teammate's state arrives once the file does.
  if (isPlaceholder(path.join(f.dir, name))) return null;
  let text: string;
  try { text = readTextWithin(home, path.join(f.dir, name), 'task record'); } catch { return null; }
  const parsed = parseRecord(text, { plan: f.plan, item: f.item });
  if (!('record' in parsed)) return null;
  signedParts.set(parsed.record, parsed.signed);
  return parsed.record;
}

/** One item's records. A file that is not a record is skipped, never guessed at. */
function readFolder(home: string, f: { plan: string; item: string; dir: string; files: string[] }): TaskRecord[] {
  const out: TaskRecord[] = [];
  for (const name of f.files) {
    const r = readOne(home, f, name);
    if (r) out.push(r);
  }
  return out;
}

function itemFolder(projectRoot: string, home: string, planUid: string, itemUid: string) {
  const dir = path.join(home, RECORDS_DIR, planUid, itemUid);
  return itemFolders(projectRoot, planUid).find((f) => f.item === itemUid) ?? { plan: planUid, item: itemUid, dir, files: [] };
}

// ── The head this machine last took or wrote: heads.ts ───────────────────

let splitListener: ((projectRoot: string) => void) | undefined;
/** Told when a project's splits start or end (the server refreshes its signals then). */
let runsListener: ((projectRoot: string) => void) | undefined;
/** Told when teammates' test runs here changed (the server broadcasts it, so grounding is asked again). */
export function setRunsChangedListener(fn: ((projectRoot: string) => void) | undefined): void { runsListener = fn; }
function runsChanged(projectRoot: string): void { try { runsListener?.(projectRoot); } catch { /* a listener never stops a read */ } }
let checkRunsListener: ((projectRoot: string) => void) | undefined;
/** Told when teammates' check runs here changed (Phase 33 C7; the server broadcasts it). */
export function setCheckRunsChangedListener(fn: ((projectRoot: string) => void) | undefined): void { checkRunsListener = fn; }
function checkRunsChanged(projectRoot: string): void { try { checkRunsListener?.(projectRoot); } catch { /* a listener never stops a read */ } }

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
  const home = plansHome(root);
  if (!home) return null;
  const me = writerId();
  const folder = itemFolder(root, home, item.planUid, item.uid);
  const existing = readFolder(home, folder);
  const mine = existing.filter((r) => r.writer === me);
  let counter = Math.max(0, ...mine.map((r) => r.counter), ...folder.files.map((f) => (f.startsWith(`${me}-`) ? parseInt(f.slice(me.length + 1), 10) || 0 : 0))) + 1;
  while (fs.existsSync(path.join(folder.dir, recordFileName(me, counter)))) counter++;
  const others = seenOf(existing.filter((r) => r.writer !== me));
  const record: TaskRecord = {
    writer: me, name: writerName(root), counter, seen: others, at: now,
    plan: item.planUid, item: item.uid, by, state: stateOf(item),
  };
  // Signed as it is written (C3.3): git's key, else this device's.
  const signature = signRecord(root, home, record, recordBytes(record));
  const file = writeFileWithin(home, path.join(folder.dir, recordFileName(me, counter)), serializeRecord(record, signature), 'task record');
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
 * Who a teammate's record says made the change: the person ("Sam Lee"), or
 * the agent working on their machine ("claude-code for Sam Lee"). A person in
 * their window and one over their local API read alike here. Verified (C3.3),
 * the person is whose key signed it, not the name the file claims.
 */
function recordCheck(r: TaskRecord, v: Verdict): RecordCheck {
  const person = r.by.authorType === 'human' || r.by.authorType === 'unverified' || r.by.author === r.name;
  const as = (who: string) => (person ? who : `${r.by.author} for ${who}`);
  return v.verified
    ? { verified: true, claimed: as(r.name), how: v.how, who: v.who, author: as(v.who) }
    : { verified: false, claimed: as(r.name), why: v.why };
}

function recordAuthor(check: RecordCheck): { author: string; authorType: string } {
  return { author: check.verified && check.author ? check.author : check.claimed, authorType: 'record' };
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
  const home = plansHome(projectRoot);
  if (!home) return result;
  readKeyIntroductions(home, me);
  let ctx: CheckContext | null = null;
  let changed = false;
  for (const f of itemFolders(projectRoot, onlyPlan)) {
    const item = getItem(f.item);
    // Only a task this machine has, in the plan the folder names.
    if (!item || item.planUid !== f.plan || item.kind !== 'action') continue;
    if (getPlan(f.plan)?.projectPath !== projectRoot) continue;
    const { records, clashing } = distinctRecords(readFolder(home, f));
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
    if (head.writer === me) { setHead(item.uid, head.writer, head.counter, null); continue; }
    ctx ??= checkContext(projectRoot);
    const check = recordCheck(head, verifyTaskRecord(head, signedOf(head), ctx));
    setHead(item.uid, head.writer, head.counter, null, check);
    const s = head.state;
    const applied = applyRecordedState(item.uid, {
      status: (s.status ?? 'pending') as PlanItem['status'],
      assignee: s.assignee, assigneeType: s.assigneeType,
      progressPercent: s.progressPercent, blockedReason: s.blockedReason,
    }, recordAuthor(check));
    if (applied) {
      result.applied.push(item.uid);
      onApplied?.(applied);
    }
  }
  // Teammates' material reads (C3.5), when they are shared too.
  if (isSharingMaterialReads(projectRoot) && readTeammateReads(projectRoot, home, me, onlyPlan) > 0) changed = true;
  // Teammates' test runs (D1.5a).
  if (readTeammateRuns(projectRoot, home, me) > 0) runsChanged(projectRoot);
  // Teammates' check runs (Phase 33 C7).
  if (readTeammateCheckRuns(projectRoot, home, me) > 0) checkRunsChanged(projectRoot);
  if (changed) splitsChanged(projectRoot);
  return result;
}

// ── Trusting a teammate's key ────────────────────────────────────────────

/**
 * Trust or refuse a teammate's device key, then check again every task whose
 * state that device's records set here: trusting Sam's key turns his records
 * "signed" without anyone changing a task. The caller checks the person asked.
 */
export function trustTeammateKey(writer: string, fingerprint: string, trust: boolean, by: string): { key: TeammateKey; rechecked: string[] } | null {
  const key = decideKey(writer, fingerprint, trust, by);
  if (!key) return null;
  // Its material reads and test runs are read again, so who made them is checked again (C3.5, D1.5a).
  forgetReadsBy(writer);
  forgetTeammateRuns({ writer });
  forgetTeammateCheckRuns({ writer });
  const me = writerId();
  for (const v of getDb().exec('SELECT project_root FROM shared_task_state WHERE enabled = 1')[0]?.values ?? []) {
    const root = String(v[0]);
    const home = plansHome(root);
    if (home && isSharingMaterialReads(root) && readTeammateReads(root, home, me) > 0) splitsChanged(root);
    if (home && readTeammateRuns(root, home, me) > 0) runsChanged(root);
    if (home && readTeammateCheckRuns(root, home, me) > 0) checkRunsChanged(root);
  }
  const rechecked: string[] = [];
  for (const h of headsBy(writer)) {
    const item = getItem(h.itemUid);
    const root = item ? getPlan(item.planUid)?.projectPath : null;
    const home = root ? plansHome(root) : null;
    if (!item || !root || !home || !isRecordId(item.planUid) || !isRecordId(item.uid)) continue;
    const folder = { plan: item.planUid, item: item.uid, dir: path.join(home, RECORDS_DIR, item.planUid, item.uid) };
    const r = readOne(home, folder, recordFileName(writer, h.counter));
    if (!r) continue;
    setHeadCheck(item.uid, recordCheck(r, verifyTaskRecord(r, signedOf(r), checkContext(root))));
    rechecked.push(item.uid);
  }
  return { key, rechecked };
}

// ── Watching ─────────────────────────────────────────────────────────────

const watchers = new Map<string, FSWatcher>();
const watcherReady = new Map<string, Promise<void>>();
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
/**
 * Resolves once the watcher has scanned what is there. A folder made before
 * then (the first record written right after sharing is turned on) may never
 * be watched, so a teammate's record pulled into it later would go unread:
 * callers that write next wait for it (C3.4a's tests found it on a cold run).
 */
export function startRecordWatcher(projectRoot: string): Promise<void> {
  if (watchers.has(projectRoot)) return watcherReady.get(projectRoot) ?? Promise.resolve();
  if (!isSharingTaskState(projectRoot)) return Promise.resolve();
  const home = plansHome(projectRoot);
  if (!home) return Promise.resolve();
  const dir = path.join(home, RECORDS_DIR);
  // Teammates' material reads (C3.5) and test runs (D1.5a) arrive beside their records.
  const reads = path.join(home, READS_DIR);
  const runs = path.join(home, RUNS_DIR);
  try { for (const d of [dir, reads, runs]) fs.mkdirSync(d, { recursive: true }); } catch { return Promise.resolve(); }
  let timer: NodeJS.Timeout | null = null;
  const watcher = chokidar.watch([dir, reads, runs], {
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
  const ready = new Promise<void>((resolve) => {
    watcher.once('ready', () => resolve());
    // A watcher that never reports ready must not hold a request forever.
    setTimeout(resolve, 5_000).unref?.();
  });
  watcherReady.set(projectRoot, ready);
  return ready;
}

export function stopRecordWatcher(projectRoot: string): void {
  const w = watchers.get(projectRoot);
  if (!w) return;
  watchers.delete(projectRoot);
  watcherReady.delete(projectRoot);
  void w.close();
}
