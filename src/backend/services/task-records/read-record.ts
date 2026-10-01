/**
 * A material-read record: which version of a material a task read, on one
 * device, written once and never edited (Phase 32 C3.5).
 *
 * A6.2 keeps each read on the machine it happened on, so A6's material
 * signals saw only one person's work. With a team's plans folder shared,
 * each app also writes its tasks' reads as records beside its task-state
 * records (C3.1):
 *
 *     .codetrellis/reads/<plan>/<item>/<writer>-<counter>.yaml
 *
 * One is written when a task here reads a version of a material it has not
 * recorded reading before, not on every read: what teammates need is which
 * version each task worked from. The material is named as it is stored
 * (C3.4c: project-relative, or `plans://…` inside the plans folder), so one
 * file is one material on every machine, and its sha256 says which version.
 *
 * Untrusted input, like a task-state record: anyone who can write to the
 * folder can write one, so it is parsed here with limits, its material is a
 * name to compare and never a path to open, and who read it is a claim until
 * its signature verifies (C3.3). Pure: no file is read or written here.
 */

import { parse as parseYaml, stringify as stringifyYaml } from 'yaml';
import { canonicalJson, parseSignature, type RecordSignature } from './signing';
import type { SignedPart } from './record';
import { isStoredPlace } from '../material-place';

/** Signed into every read record, so one can never be read as a task-state record or the other way round. */
const KIND = 'material-read';

export interface ReadRecord {
  writer: string;
  /** The person whose device it is, as that device says. A claim. */
  name: string;
  /** 1, 2, 3… per writer per item. */
  counter: number;
  /** When, by the writer's clock (ms). */
  at: number;
  plan: string;
  item: string;
  /** Who read it on that device: an agent, or the person. */
  by: { author: string; authorType: string };
  /** The material as stored: `data/sales.xlsx` or `plans://data/sales.xlsx`. */
  material: string;
  /** The attachment it was read through, when the plan's files carry it. */
  attachment: string | null;
  /** The file's sha256 when it was read: which version. */
  sha256: string | null;
}

export const MAX_READ_RECORD_BYTES = 8 * 1024;
const WRITER = /^[a-f0-9]{8,32}$/;
const ID = /^[a-z0-9][a-z0-9-]{0,63}$/i;
const SHA = /^[a-f0-9]{64}$/;

const text = (v: unknown, max: number): string | null => (typeof v === 'string' && v.length > 0 ? v.slice(0, max) : null);

function bodyOf(r: ReadRecord) {
  return {
    kind: KIND, writer: r.writer, name: r.name, counter: r.counter, at: new Date(r.at).toISOString(),
    plan: r.plan, item: r.item, by: r.by, material: r.material, attachment: r.attachment, sha256: r.sha256,
  };
}

/** The exact bytes a read record's signature is over. */
export function readRecordBytes(r: ReadRecord): string {
  return canonicalJson(bodyOf(r));
}

export function serializeReadRecord(r: ReadRecord, signature?: RecordSignature | null): string {
  const body = signature ? { ...bodyOf(r), signature } : bodyOf(r);
  return `# CodeTrellis: which version of a material a task read, written once by one device.\n${stringifyYaml(body, { lineWidth: 0 })}`;
}

/** A read record from a file's text, or why not. `where` is the plan and item its folder names. */
export function parseReadRecord(source: string, where: { plan: string; item: string }): { record: ReadRecord; signed: SignedPart } | { error: string } {
  if (Buffer.byteLength(source, 'utf8') > MAX_READ_RECORD_BYTES) return { error: 'larger than a read record can be' };
  let raw: unknown;
  try { raw = parseYaml(source, { maxAliasCount: 0 }); } catch { return { error: 'not YAML' }; }
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return { error: 'not a record' };
  const { signature: rawSignature, ...r } = raw as Record<string, unknown>;
  if (r.kind !== KIND) return { error: 'not a material-read record' };
  const writer = typeof r.writer === 'string' && WRITER.test(r.writer) ? r.writer : null;
  if (!writer) return { error: 'no writer' };
  const counter = Number.isSafeInteger(r.counter) && (r.counter as number) > 0 ? (r.counter as number) : null;
  if (!counter) return { error: 'no counter' };
  if (r.plan !== where.plan || r.item !== where.item) return { error: 'names another task than its folder' };
  const material = typeof r.material === 'string' && r.material.length <= 1024 && isStoredPlace(r.material) ? r.material : null;
  if (!material) return { error: 'names no material in the project or its plans folder' };
  const at = typeof r.at === 'string' ? Date.parse(r.at) : NaN;
  const by = r.by && typeof r.by === 'object' ? r.by as Record<string, unknown> : {};
  return {
    signed: { bytes: canonicalJson(r), signature: parseSignature(rawSignature) },
    record: {
      writer,
      name: text(r.name, 120) ?? 'someone',
      counter,
      at: Number.isFinite(at) ? at : 0,
      plan: where.plan,
      item: where.item,
      by: { author: text(by.author, 120) ?? 'someone', authorType: text(by.authorType, 40) ?? 'unknown' },
      material,
      attachment: typeof r.attachment === 'string' && ID.test(r.attachment) ? r.attachment : null,
      sha256: typeof r.sha256 === 'string' && SHA.test(r.sha256) ? r.sha256 : null,
    },
  };
}
