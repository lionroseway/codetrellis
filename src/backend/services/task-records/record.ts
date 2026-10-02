/**
 * A task-state record: one file, one writer, written once and never edited
 * (Phase 32 C3.1; shared-work doc C-3, "Carried by git or by a synced
 * folder").
 *
 * Each device writes only its own records,
 * `.codetrellis/records/<plan>/<item>/<writer>-<counter>.yaml`, and the
 * state everyone sees is read from all of them. Two people acting at once
 * make two files, so neither git nor a sync client has anything to merge.
 *
 * Order does not trust clocks. A record carries its writer's counter and the
 * highest counter it had seen from each other writer of that item, so "Sam's
 * record was made after seeing Dana's" is a fact of the files, not of two
 * laptops' clocks. The time is kept for people to read.
 *
 * A record is untrusted input: anyone who can write to the folder can write
 * one claiming to be anyone. Parsed here with limits, it never supplies a
 * path, and its `by` is a claim, shown as unverified unless the record's
 * signature verifies (C3.3, `signing.ts`). Pure: no file is read or written
 * here.
 */

import { parse as parseYaml, stringify as stringifyYaml } from 'yaml';
import { canonicalJson, parseSignature, type RecordSignature } from './signing';

/** The item state a record carries: the fields C2.4b took out of the plan's files. */
export interface RecordedState {
  status: string | null;
  assignee: string | null;
  assigneeType: string | null;
  progressPercent: number | null;
  blockedReason: string | null;
}

export interface TaskRecord {
  /** The device that wrote it: a random id, the same for every record it writes. */
  writer: string;
  /** The person whose device it is, as that device says (git's user.name). A claim. */
  name: string;
  /** 1, 2, 3… per writer per item. */
  counter: number;
  /** The highest counter seen from each other writer of this item when it was written. */
  seen: Record<string, number>;
  /** When, by the writer's clock (ms). For reading only; never for order. */
  at: number;
  plan: string;
  item: string;
  /** Who made the change on that device: the person, or which agent. */
  by: { author: string; authorType: string };
  state: RecordedState;
}

export const MAX_RECORD_BYTES = 16 * 1024;
/** Writers named in one record's `seen`; more is not a team, it is noise. */
const MAX_SEEN = 256;
const STATUSES = new Set(['pending', 'assigned', 'in_progress', 'blocked', 'done', 'skipped']);
const ID = /^[a-z0-9][a-z0-9-]{0,63}$/i;
const WRITER = /^[a-f0-9]{8,32}$/;

const text = (v: unknown, max: number): string | null => (typeof v === 'string' && v.length > 0 ? v.slice(0, max) : null);

/** The file a record is written to, inside its item's folder. */
export function recordFileName(writer: string, counter: number): string {
  return `${writer}-${counter}.yaml`;
}

function bodyOf(r: TaskRecord) {
  return {
    writer: r.writer, name: r.name, counter: r.counter, seen: r.seen,
    at: new Date(r.at).toISOString(), plan: r.plan, item: r.item, by: r.by, state: r.state,
  };
}

/** The exact bytes a record's signature is over: its body as canonical JSON (C3.3). */
export function recordBytes(r: TaskRecord): string {
  return canonicalJson(bodyOf(r));
}

/** A record as YAML, with a note for anyone who opens it, and its signature when it has one. */
export function serializeRecord(r: TaskRecord, signature?: RecordSignature | null): string {
  const body = signature ? { ...bodyOf(r), signature } : bodyOf(r);
  return `# CodeTrellis task state, written once by one device and never edited.\n# The state everyone sees is read from all of these; delete none.\n${stringifyYaml(body, { lineWidth: 0 })}`;
}

/** What a record's file says of its signature: the bytes it claims to sign, and how. */
export interface SignedPart { bytes: string; signature: RecordSignature | null }

/**
 * A record from a file's text, or why not. `where` is the plan and item the
 * folder belongs to: a record naming another is not read, so a file copied
 * into the wrong folder cannot move state between tasks.
 */
export function parseRecord(source: string, where: { plan: string; item: string }): { record: TaskRecord; signed: SignedPart } | { error: string } {
  if (Buffer.byteLength(source, 'utf8') > MAX_RECORD_BYTES) return { error: 'larger than a record can be' };
  let raw: unknown;
  try { raw = parseYaml(source, { maxAliasCount: 0 }); } catch { return { error: 'not YAML' }; }
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return { error: 'not a record' };
  const { signature: rawSignature, ...r } = raw as Record<string, unknown>;
  const writer = typeof r.writer === 'string' && WRITER.test(r.writer) ? r.writer : null;
  if (!writer) return { error: 'no writer' };
  const counter = Number.isSafeInteger(r.counter) && (r.counter as number) > 0 ? (r.counter as number) : null;
  if (!counter) return { error: 'no counter' };
  if (r.plan !== where.plan || r.item !== where.item) return { error: 'names another task than its folder' };
  const seen: Record<string, number> = {};
  if (r.seen && typeof r.seen === 'object' && !Array.isArray(r.seen)) {
    const entries = Object.entries(r.seen as Record<string, unknown>);
    if (entries.length > MAX_SEEN) return { error: 'names too many writers' };
    for (const [w, c] of entries) {
      if (WRITER.test(w) && w !== writer && Number.isSafeInteger(c) && (c as number) > 0) seen[w] = c as number;
    }
  }
  const at = typeof r.at === 'string' ? Date.parse(r.at) : NaN;
  const by = r.by && typeof r.by === 'object' ? r.by as Record<string, unknown> : {};
  const s = r.state && typeof r.state === 'object' && !Array.isArray(r.state) ? r.state as Record<string, unknown> : null;
  if (!s) return { error: 'no state' };
  const status = typeof s.status === 'string' && STATUSES.has(s.status) ? s.status : null;
  const pct = typeof s.progressPercent === 'number' && Number.isFinite(s.progressPercent)
    ? Math.max(0, Math.min(100, Math.round(s.progressPercent)))
    : null;
  return {
    // Everything but the signature, exactly as the file has it: a field
    // added or changed after signing makes these bytes differ.
    signed: { bytes: canonicalJson(r), signature: parseSignature(rawSignature) },
    record: {
      writer,
      name: text(r.name, 120) ?? 'someone',
      counter,
      seen,
      at: Number.isFinite(at) ? at : 0,
      plan: where.plan,
      item: where.item,
      by: { author: text(by.author, 120) ?? 'someone', authorType: text(by.authorType, 40) ?? 'unknown' },
      state: {
        status,
        assignee: text(s.assignee, 200),
        assigneeType: text(s.assigneeType, 40),
        progressPercent: pct,
        blockedReason: text(s.blockedReason, 500),
      },
    },
  };
}

/** A plan or item uid as a folder name: nothing a path could be made of. */
export function isRecordId(id: string): boolean {
  return ID.test(id);
}

/** True when `a` was written after its writer had seen `b`. */
export function supersedes(a: TaskRecord, b: TaskRecord): boolean {
  if (a.writer === b.writer) return a.counter > b.counter;
  return (a.seen[b.writer] ?? 0) >= b.counter;
}

/**
 * One item's records, in a form that reading twice cannot change: a record
 * seen twice (a sync's "conflicted copy", the same file pulled again) is one
 * record, and two different records under one writer and counter, which no
 * honest writer makes, are both kept as `clashing`.
 */
export function distinctRecords(records: readonly TaskRecord[]): { records: TaskRecord[]; clashing: TaskRecord[] } {
  const byKey = new Map<string, TaskRecord>();
  const clashing: TaskRecord[] = [];
  for (const r of records) {
    const key = `${r.writer}-${r.counter}`;
    const known = byKey.get(key);
    if (!known) { byKey.set(key, r); continue; }
    if (JSON.stringify(known) !== JSON.stringify(r)) clashing.push(r);
  }
  return { records: [...byKey.values()], clashing };
}

/** The records nothing else supersedes: one when everyone has seen it, more when people acted at once. */
export function heads(records: readonly TaskRecord[]): TaskRecord[] {
  return records.filter((r) => !records.some((o) => o !== r && supersedes(o, r)));
}

/** The highest counter of each writer among `records`. */
export function seenOf(records: readonly TaskRecord[]): Record<string, number> {
  const out: Record<string, number> = {};
  for (const r of records) out[r.writer] = Math.max(out[r.writer] ?? 0, r.counter);
  return out;
}

/** True when two records leave the task in the same state. */
export function sameState(a: RecordedState, b: RecordedState): boolean {
  return a.status === b.status && a.assignee === b.assignee && a.progressPercent === b.progressPercent && a.blockedReason === b.blockedReason;
}

/**
 * What the records say of one item:
 *  - `settled`: one head, or several that agree. The state to show.
 *  - `split`: people acted at once and disagree. Nothing is picked; each is named.
 */
export function readItem(records: readonly TaskRecord[]):
  | { kind: 'none' }
  | { kind: 'settled'; head: TaskRecord }
  | { kind: 'split'; heads: TaskRecord[] } {
  const { records: distinct } = distinctRecords(records);
  const top = heads(distinct);
  if (top.length === 0) return { kind: 'none' };
  const newest = [...top].sort((a, b) => b.at - a.at || (a.writer < b.writer ? -1 : 1));
  if (newest.every((h) => sameState(h.state, newest[0].state))) return { kind: 'settled', head: newest[0] };
  return { kind: 'split', heads: newest };
}
