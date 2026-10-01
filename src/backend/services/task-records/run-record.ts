/**
 * A test-run record: what one device's test run said, test file by test
 * file, and which commit it ran against (Phase 32 D1.5a).
 *
 * B8.1 keeps test results on the machine they were reported on, so a run in
 * a cloud session or a CI job never reached the person's desktop, and B8.2's
 * "tests older than the code" compared the run with the files' times on
 * this disk, which a pull resets. With task state shared (C3.1), each app
 * also writes its latest run as a record in the plans folder:
 *
 *     .codetrellis/runs/<writer>-<counter>.yaml
 *
 * written once and never edited; a device removes its own older runs when it
 * writes a new one, so the folder holds each device's latest and two
 * branches never edit the same file. A record names the commit the tests ran
 * against and the files that differed from it then, so a reader asks git
 * whether a file changed since, not its clock.
 *
 * Untrusted input, like every record: parsed here with limits; a test file is
 * a name to compare and never a path to open; who ran it is a claim until
 * its signature verifies (C3.3). Pure: no file is read or written here.
 */

import { parse as parseYaml, stringify as stringifyYaml } from 'yaml';
import { canonicalJson, parseSignature, type RecordSignature } from './signing';
import type { SignedPart } from './record';

/** Signed into every run record, so one can never be read as another kind. */
const KIND = 'test-run';

export interface RunFailure { name: string; result: 'failed' | 'error'; why: string | null }
/** One test file's results: counts, and the failing tests named (at most 50; `failed` counts them all). */
export interface RunFile { file: string; passed: number; failed: number; skipped: number; failing: RunFailure[] }

export interface RunRecord {
  writer: string;
  /** The person whose device it is, as that device says. A claim. */
  name: string;
  counter: number;
  /** When the run happened, by the writer's clock (ms): the report's time. */
  at: number;
  /** Who handed the report over on that device: an agent, or the person. */
  by: { author: string; authorType: string };
  /** The commit the tests ran against, or null outside git. */
  commit: string | null;
  /** Files that differed from that commit when the tests ran: their results say nothing about the commit. */
  dirty: string[];
  /** The report it came from, as a label. */
  report: string;
  totals: { tests: number; passed: number; failed: number; errors: number; skipped: number };
  files: RunFile[];
}

export const MAX_RUN_RECORD_BYTES = 512 * 1024;
const MAX_FILES = 5_000;
const MAX_FAILING_PER_FILE = 50;
const MAX_DIRTY = 500;
const WRITER = /^[a-f0-9]{8,32}$/;
const SHA = /^[a-f0-9]{40}$/;

const text = (v: unknown, max: number): string | null => (typeof v === 'string' && v.length > 0 ? v.slice(0, max) : null);
const count = (v: unknown): number => (Number.isSafeInteger(v) && (v as number) >= 0 ? (v as number) : 0);

/** A project-relative path as a record may name one: forward slashes, nothing outside. */
export function isRunPath(p: unknown): p is string {
  return typeof p === 'string' && p.length > 0 && p.length <= 1024 && !p.includes('\\') && !p.includes('\0')
    && !p.startsWith('/') && !/^[A-Za-z]:/.test(p) && !p.split('/').some((x) => x === '..' || x === '');
}

function bodyOf(r: RunRecord) {
  return {
    kind: KIND, writer: r.writer, name: r.name, counter: r.counter, at: new Date(r.at).toISOString(),
    by: r.by, commit: r.commit, dirty: r.dirty, report: r.report, totals: r.totals,
    files: r.files.map((f) => ({ file: f.file, passed: f.passed, failed: f.failed, skipped: f.skipped, failing: f.failing.map((x) => ({ name: x.name, result: x.result, why: x.why })) })),
  };
}

/** The exact bytes a run record's signature is over. */
export function runRecordBytes(r: RunRecord): string {
  return canonicalJson(bodyOf(r));
}

export function serializeRunRecord(r: RunRecord, signature?: RecordSignature | null): string {
  const body = signature ? { ...bodyOf(r), signature } : bodyOf(r);
  return `# CodeTrellis: one device's latest test run, by test file, and the commit it ran against.\n${stringifyYaml(body, { lineWidth: 0 })}`;
}

/** A run record from a file's text, or why not. */
export function parseRunRecord(source: string): { record: RunRecord; signed: SignedPart } | { error: string } {
  if (Buffer.byteLength(source, 'utf8') > MAX_RUN_RECORD_BYTES) return { error: 'larger than a run record can be' };
  let raw: unknown;
  try { raw = parseYaml(source, { maxAliasCount: 0 }); } catch { return { error: 'not YAML' }; }
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return { error: 'not a record' };
  const { signature: rawSignature, ...r } = raw as Record<string, unknown>;
  if (r.kind !== KIND) return { error: 'not a test-run record' };
  const writer = typeof r.writer === 'string' && WRITER.test(r.writer) ? r.writer : null;
  if (!writer) return { error: 'no writer' };
  const counter = Number.isSafeInteger(r.counter) && (r.counter as number) > 0 ? (r.counter as number) : null;
  if (!counter) return { error: 'no counter' };
  const at = typeof r.at === 'string' ? Date.parse(r.at) : NaN;
  if (!Number.isFinite(at)) return { error: 'no time' };
  const by = r.by && typeof r.by === 'object' ? r.by as Record<string, unknown> : {};
  const t = r.totals && typeof r.totals === 'object' ? r.totals as Record<string, unknown> : {};
  const files: RunFile[] = [];
  for (const f of Array.isArray(r.files) ? r.files.slice(0, MAX_FILES) : []) {
    if (!f || typeof f !== 'object' || !isRunPath((f as Record<string, unknown>).file)) continue;
    const ff = f as Record<string, unknown>;
    const failing: RunFailure[] = [];
    for (const x of Array.isArray(ff.failing) ? ff.failing.slice(0, MAX_FAILING_PER_FILE) : []) {
      const xx = x && typeof x === 'object' ? x as Record<string, unknown> : {};
      const name = text(xx.name, 300);
      if (!name) continue;
      failing.push({ name, result: xx.result === 'error' ? 'error' : 'failed', why: text(xx.why, 500) });
    }
    files.push({ file: ff.file as string, passed: count(ff.passed), failed: Math.max(count(ff.failed), failing.length), skipped: count(ff.skipped), failing });
  }
  return {
    signed: { bytes: canonicalJson(r), signature: parseSignature(rawSignature) },
    record: {
      writer,
      name: text(r.name, 120) ?? 'someone',
      counter,
      at,
      by: { author: text(by.author, 120) ?? 'someone', authorType: text(by.authorType, 40) ?? 'unknown' },
      commit: typeof r.commit === 'string' && SHA.test(r.commit) ? r.commit : null,
      dirty: (Array.isArray(r.dirty) ? r.dirty : []).filter(isRunPath).slice(0, MAX_DIRTY),
      report: text(r.report, 300) ?? 'a test report',
      totals: { tests: count(t.tests), passed: count(t.passed), failed: count(t.failed), errors: count(t.errors), skipped: count(t.skipped) },
      files,
    },
  };
}

/** A run's results by test file, from the cases a report held. Cases with no file are counted in the totals only. */
export function runFilesOf(cases: ReadonlyArray<{ testFile: string | null; name: string; result: string; message: string | null }>): RunFile[] {
  const by = new Map<string, RunFile>();
  for (const c of cases) {
    if (!c.testFile || !isRunPath(c.testFile)) continue;
    let f = by.get(c.testFile);
    if (!f) { f = { file: c.testFile, passed: 0, failed: 0, skipped: 0, failing: [] }; by.set(c.testFile, f); }
    if (c.result === 'passed') f.passed++;
    else if (c.result === 'skipped') f.skipped++;
    else if (++f.failed <= MAX_FAILING_PER_FILE) f.failing.push({ name: c.name.slice(0, 300), result: c.result === 'error' ? 'error' : 'failed', why: c.message ? c.message.slice(0, 500) : null });
  }
  return [...by.values()].sort((a, b) => a.file.localeCompare(b.file)).slice(0, MAX_FILES);
}
