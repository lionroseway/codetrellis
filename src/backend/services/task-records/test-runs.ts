/**
 * Test runs shared through the plans folder (Phase 32 D1.5a).
 *
 * Where task state is shared (C3.1), each new run reported on this device is
 * written as a run record (`run-record.ts`) under `.codetrellis/runs/`, and
 * this device's older run records are removed: the folder holds each
 * device's latest. Teammates' are read as their records are, after a pull or
 * a sync, and kept one per device (`tests/teammate-runs.ts`), so a run in a
 * cloud session or a CI job grounds the files on the person's desktop.
 *
 * Signed and checked as every record is (C3.3); an unverified run still
 * counts, and says so wherever its runner is named. Untrusted input: read
 * through the confined helper, never through a link or a placeholder, size
 * and count limited.
 */

import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { readTextWithin, removeWithin, writeFileWithin } from '../confined-fs';
import { isPlaceholder } from '../cloud-files';
import { testFileOf } from '../tests/grounding';
import { knownRunCounters, putTeammateRun } from '../tests/teammate-runs';
import type { RecordedRun } from '../tests/test-results';
import { parseRunRecord, runFilesOf, runRecordBytes, serializeRunRecord, type RunRecord } from './run-record';
import { checkContext, signRecord, verifyTaskRecord } from './trust';

export const RUNS_DIR = path.join('.codetrellis', 'runs');
const FILE = /^([a-f0-9]{8,32})-(\d{1,9})\.yaml$/;
const MAX_FILES = 2_000;
const MAX_DIRTY = 500;

const git = (root: string, args: string[]): string | null => {
  try { return execFileSync('git', ['-C', root, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], maxBuffer: 16 * 1024 * 1024 }); } catch { return null; }
};

function filesIn(dir: string): Array<{ name: string; writer: string; counter: number }> {
  try {
    return fs.readdirSync(dir, { withFileTypes: true })
      .filter((e) => e.isFile() && FILE.test(e.name))
      .slice(0, MAX_FILES)
      .map((e) => { const m = FILE.exec(e.name)!; return { name: e.name, writer: m[1], counter: Number(m[2]) }; });
  } catch { return []; }
}

/** The commit the tests ran against, and what differed from it then (outside CodeTrellis's own files). */
export function codeAt(projectRoot: string): { commit: string | null; dirty: string[] } {
  const commit = git(projectRoot, ['rev-parse', 'HEAD'])?.trim() || null;
  if (!commit) return { commit: null, dirty: [] };
  const out = git(projectRoot, ['status', '--porcelain=v1', '-z', '--untracked-files=all']) ?? '';
  const dirty: string[] = [];
  const parts = out.split('\0');
  for (let i = 0; i < parts.length && dirty.length < MAX_DIRTY; i++) {
    const entry = parts[i];
    if (entry.length < 4) continue;
    const file = entry.slice(3);
    if (entry[0] === 'R' || entry[0] === 'C') i++; // the old name follows
    if (!file.startsWith('.codetrellis/')) dirty.push(file);
  }
  return { commit, dirty };
}

/**
 * Write this device's record of a run, and remove its older ones. Returns
 * the file written. `where.home` is the project's plans folder (C3.4a).
 */
export function writeRunRecord(where: { projectRoot: string; home: string; me: string; name: string }, run: RecordedRun): string {
  const dir = path.join(where.home, RUNS_DIR);
  const mine = filesIn(dir).filter((f) => f.writer === where.me);
  let counter = Math.max(0, ...mine.map((f) => f.counter)) + 1;
  while (fs.existsSync(path.join(dir, `${where.me}-${counter}.yaml`))) counter++;
  const { commit, dirty } = codeAt(where.projectRoot);
  const record: RunRecord = {
    writer: where.me, name: where.name, counter, at: run.ranAt, by: run.by, commit, dirty, report: run.path, totals: run.totals,
    files: runFilesOf(run.cases.map((c) => ({ testFile: testFileOf(where.projectRoot, c), name: c.name, result: c.result, message: c.message }))),
  };
  const signature = signRecord(where.projectRoot, where.home, record, runRecordBytes(record));
  const file = writeFileWithin(where.home, path.join(dir, `${where.me}-${counter}.yaml`), serializeRunRecord(record, signature), 'test-run record');
  // Only the latest is kept: a device removes its own older runs, never another's.
  for (const f of mine) {
    try { removeWithin(where.home, path.join(dir, f.name), {}, 'test-run record'); } catch { /* already gone */ }
  }
  return file;
}

/**
 * Read teammates' run records in a project: each device's newest, when it is
 * newer than the one already read here. Returns how many were new.
 */
export function readTeammateRuns(projectRoot: string, home: string, me: string): number {
  const dir = path.join(home, RUNS_DIR);
  const known = knownRunCounters(projectRoot);
  const newest = new Map<string, { name: string; counter: number }>();
  for (const f of filesIn(dir)) {
    if (f.writer === me) continue;
    const at = newest.get(f.writer);
    if (!at || f.counter > at.counter) newest.set(f.writer, f);
  }
  let added = 0;
  let ctx: ReturnType<typeof checkContext> | null = null;
  for (const [writer, f] of newest) {
    if ((known.get(writer) ?? 0) >= f.counter) continue;
    const file = path.join(dir, f.name);
    if (isPlaceholder(file)) continue; // still in the cloud (C3.4b)
    let text: string;
    try { text = readTextWithin(home, file, 'test-run record'); } catch { continue; }
    const parsed = parseRunRecord(text);
    if (!('record' in parsed)) continue;
    const r = parsed.record;
    // The file's name is the record's writer and counter: a copy under another name is not read.
    if (r.writer !== writer || r.counter !== f.counter) continue;
    ctx ??= checkContext(projectRoot);
    const v = verifyTaskRecord(r, parsed.signed, ctx);
    putTeammateRun(projectRoot, {
      writer, counter: r.counter, name: v.verified ? v.who : r.name, by: r.by, commit: r.commit, dirty: r.dirty,
      at: r.at, report: r.report, totals: r.totals, files: r.files,
      verdict: v.verified ? { verified: true, how: v.how, who: v.who } : { verified: false, why: v.why },
    });
    added++;
  }
  return added;
}

/** This device's run records in a project. */
export function myRunCount(home: string | null, me: string): number {
  return home ? filesIn(path.join(home, RUNS_DIR)).filter((f) => f.writer === me).length : 0;
}
