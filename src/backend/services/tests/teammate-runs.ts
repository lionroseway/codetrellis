/**
 * Teammates' latest test runs in a project, as read from their run records
 * (Phase 32 D1.5a; `task-records/run-record.ts`). One per device. Grounding
 * reads these beside this machine's own results, and judges them by commit:
 * whether a file changed since the commit the run was made on, never by the
 * files' times on this disk, which a pull resets.
 */

import { execFileSync } from 'node:child_process';
import { getDb } from '../database';
import { markDirty } from '../persistence';
import type { RunFile } from '../task-records/run-record';

export interface TeammateRun {
  writer: string;
  counter: number;
  /** Who ran it, as people say it: "Sam Lee", or "claude-code for Sam Lee". */
  who: string;
  verified: boolean;
  /** Why it does not verify, when it does not. */
  why: string | null;
  commit: string | null;
  dirty: string[];
  at: number;
  report: string;
  totals: { tests: number; passed: number; failed: number; errors: number; skipped: number };
  files: RunFile[];
}

const parse = <T>(s: unknown, fallback: T): T => { try { return JSON.parse(String(s)) as T; } catch { return fallback; } };

export function listTeammateRuns(projectRoot: string): TeammateRun[] {
  const rows = getDb().exec(
    `SELECT writer, counter, name, by_author, by_type, commit_sha, dirty, at, report, totals, files, verdict
       FROM teammate_test_runs WHERE project_root = ? ORDER BY at DESC`,
    [projectRoot],
  )[0]?.values ?? [];
  return rows.map((r) => {
    const verdict = parse<{ verified?: boolean; who?: string; why?: string }>(r[11], {});
    const name = verdict.verified && verdict.who ? verdict.who : String(r[2]);
    const person = r[4] === 'human' || r[4] === 'unverified' || r[3] === r[2];
    return {
      writer: String(r[0]), counter: Number(r[1]),
      who: person ? name : `${String(r[3])} for ${name}`,
      verified: verdict.verified === true, why: verdict.verified ? null : verdict.why ?? null,
      commit: (r[5] as string | null) ?? null, dirty: parse<string[]>(r[6], []), at: Number(r[7]), report: String(r[8]),
      totals: parse(r[9], { tests: 0, passed: 0, failed: 0, errors: 0, skipped: 0 }), files: parse<RunFile[]>(r[10], []),
    };
  });
}

/** Teammates' runs as a list says them: who, when, at which commit, and how they went; no per-file detail. */
export function teammateRunSummaries(projectRoot: string): Array<Omit<TeammateRun, 'files' | 'dirty'> & { says: string }> {
  return listTeammateRuns(projectRoot).map(({ files: _files, dirty: _dirty, ...r }) => {
    const failing = r.totals.failed + r.totals.errors;
    const how = failing ? `${failing} of ${r.totals.tests} failing` : `${r.totals.tests - r.totals.skipped} passing`;
    return { ...r, says: `${r.who}'s run at ${r.commit ? r.commit.slice(0, 7) : 'an unknown commit'}: ${how}${r.verified ? '' : ` (unverified: ${r.why ?? 'not signed'})`}` };
  });
}

/** The newest counter read here from each device, to skip what is already known. */
export function knownRunCounters(projectRoot: string): Map<string, number> {
  const rows = getDb().exec('SELECT writer, counter FROM teammate_test_runs WHERE project_root = ?', [projectRoot])[0]?.values ?? [];
  return new Map(rows.map((r) => [String(r[0]), Number(r[1])]));
}

export function putTeammateRun(projectRoot: string, run: {
  writer: string; counter: number; name: string; by: { author: string; authorType: string }; commit: string | null; dirty: string[];
  at: number; report: string; totals: TeammateRun['totals']; files: RunFile[]; verdict: Record<string, unknown>;
}): void {
  getDb().run(
    `INSERT INTO teammate_test_runs (project_root, writer, counter, name, by_author, by_type, commit_sha, dirty, at, report, totals, files, verdict)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(project_root, writer) DO UPDATE SET counter = excluded.counter, name = excluded.name, by_author = excluded.by_author,
       by_type = excluded.by_type, commit_sha = excluded.commit_sha, dirty = excluded.dirty, at = excluded.at, report = excluded.report,
       totals = excluded.totals, files = excluded.files, verdict = excluded.verdict
     WHERE excluded.counter > teammate_test_runs.counter`,
    [projectRoot, run.writer, run.counter, run.name, run.by.author, run.by.authorType, run.commit, JSON.stringify(run.dirty), run.at, run.report,
      JSON.stringify(run.totals), JSON.stringify(run.files), JSON.stringify(run.verdict)],
  );
  markDirty();
}

/** Forget teammates' runs in a project (sharing was turned off), or one device's everywhere (its key was trusted or refused). */
export function forgetTeammateRuns(q: { projectRoot?: string; writer?: string }): number {
  const where = q.projectRoot ? 'project_root = ?' : 'writer = ?';
  const arg = q.projectRoot ?? q.writer ?? '';
  const n = Number(getDb().exec(`SELECT COUNT(*) FROM teammate_test_runs WHERE ${where}`, [arg])[0]?.values[0]?.[0] ?? 0);
  if (n) { getDb().run(`DELETE FROM teammate_test_runs WHERE ${where}`, [arg]); markDirty(); }
  return n;
}

// ── Changed since a commit ───────────────────────────────────────────────

const diffCache = new Map<string, { at: number; files: Set<string> | null }>();
const DIFF_TTL_MS = 2_000;

/**
 * Files that differ between a commit and the working tree, or null when this
 * clone does not have the commit (a shallow checkout, a rewritten branch):
 * then nothing can be said about the run's results here.
 */
export function changedSinceCommit(projectRoot: string, commit: string, now = Date.now()): Set<string> | null {
  const key = `${projectRoot}\0${commit}`;
  const hit = diffCache.get(key);
  if (hit && now - hit.at < DIFF_TTL_MS) return hit.files;
  let files: Set<string> | null;
  try {
    const out = execFileSync('git', ['-C', projectRoot, 'diff', '--name-only', commit, '--'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], maxBuffer: 32 * 1024 * 1024 });
    files = new Set(out.split('\n').map((s) => s.trim()).filter(Boolean));
  } catch {
    files = null;
  }
  diffCache.set(key, { at: now, files });
  return files;
}
