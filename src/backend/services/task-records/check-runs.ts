/**
 * Check runs shared through the plans folder (Phase 33 C7), as test runs are
 * (Phase 32 D1.5a; `test-runs.ts`).
 *
 * Where task state is shared, each check this device runs is written as a
 * check-run record (`check-run-record.ts`) under `.codetrellis/runs/checks/`,
 * and this device's older ones are removed: the folder holds each device's
 * latest. Teammates' are read after a pull or a sync, one per device, so a
 * check run in CI appears in the app, saying where it ran.
 *
 * Signed and checked as every record is (C3.3); an unverified run still
 * shows, and says so. Untrusted input: read through the confined helper,
 * never through a link or a placeholder, size and count limited.
 */

import fs from 'node:fs';
import path from 'node:path';
import { readTextWithin, removeWithin, writeFileWithin } from '../confined-fs';
import { isPlaceholder } from '../cloud-files';
import { knownCheckRunCounters, putTeammateCheckRun, type NewCheckRun } from '../check-runs';
import { checkRunBytes, parseCheckRun, serializeCheckRun, type CheckRunRecord } from './check-run-record';
import { RUNS_DIR } from './test-runs';
import { checkContext, signRecord, verifyTaskRecord } from './trust';

export const CHECK_RUNS_DIR = path.join(RUNS_DIR, 'checks');
const FILE = /^([a-f0-9]{8,32})-(\d{1,9})\.yaml$/;
const MAX_FILES = 2_000;

function filesIn(dir: string): Array<{ name: string; writer: string; counter: number }> {
  try {
    return fs.readdirSync(dir, { withFileTypes: true })
      .filter((e) => e.isFile() && FILE.test(e.name))
      .slice(0, MAX_FILES)
      .map((e) => { const m = FILE.exec(e.name)!; return { name: e.name, writer: m[1], counter: Number(m[2]) }; });
  } catch { return []; }
}

/** Write this device's record of a check run, and remove its older ones. Returns the file written. */
export function writeCheckRunRecord(where: { projectRoot: string; home: string; me: string; name: string }, run: NewCheckRun): string {
  const dir = path.join(where.home, CHECK_RUNS_DIR);
  const mine = filesIn(dir).filter((f) => f.writer === where.me);
  let counter = Math.max(0, ...mine.map((f) => f.counter)) + 1;
  while (fs.existsSync(path.join(dir, `${where.me}-${counter}.yaml`))) counter++;
  const { projectRoot: _root, ...rest } = run;
  const record: CheckRunRecord = { ...rest, writer: where.me, name: where.name, counter };
  const signature = signRecord(where.projectRoot, where.home, record, checkRunBytes(record));
  const file = writeFileWithin(where.home, path.join(dir, `${where.me}-${counter}.yaml`), serializeCheckRun(record, signature), 'check-run record');
  for (const f of mine) {
    try { removeWithin(where.home, path.join(dir, f.name), {}, 'check-run record'); } catch { /* already gone */ }
  }
  return file;
}

/** Read teammates' check-run records: each device's newest, when newer than the one read here. Returns how many were new. */
export function readTeammateCheckRuns(projectRoot: string, home: string, me: string): number {
  const dir = path.join(home, CHECK_RUNS_DIR);
  const known = knownCheckRunCounters(projectRoot);
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
    if (isPlaceholder(file)) continue;
    let text: string;
    try { text = readTextWithin(home, file, 'check-run record'); } catch { continue; }
    const parsed = parseCheckRun(text);
    if (!('record' in parsed)) continue;
    const r = parsed.record;
    // The file's name is the record's writer and counter: a copy under another name is not read.
    if (r.writer !== writer || r.counter !== f.counter) continue;
    ctx ??= checkContext(projectRoot);
    const v = verifyTaskRecord(r, parsed.signed, ctx);
    putTeammateCheckRun(projectRoot, r, v.verified ? { verified: true, how: v.how, who: v.who } : { verified: false, why: v.why });
    added++;
  }
  return added;
}

/** This device's check-run records in a project. */
export function myCheckRunCount(home: string | null, me: string): number {
  return home ? filesIn(path.join(home, CHECK_RUNS_DIR)).filter((f) => f.writer === me).length : 0;
}
