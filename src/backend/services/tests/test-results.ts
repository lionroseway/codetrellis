/**
 * Each test's last result, from the reports agents hand over (Phase 32 B8.1;
 * observability doc §9, "Grounding: tests and evidence").
 *
 * CodeTrellis never runs tests. An agent runs them and hands over the JUnit
 * report (`report_tests`, or as a `test` criterion's evidence); this reads
 * it test by test and keeps, per project, each test's last result and when
 * the run that produced it happened (the report file's mtime, which is what
 * B8.2 compares with the code's changes). A report read twice changes
 * nothing; an older run never overwrites a newer result.
 *
 * Reports are untrusted input: read through the confined-file helper inside
 * an opened project, size limited, parsed in `junit.ts`, and what they name
 * is kept as labels, never opened.
 */

import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { getDb } from '../database';
import { markDirty } from '../persistence';
import { readFileWithin, resolveWithin, ConfinementError } from '../confined-fs';
import { parseJUnit, testLabel, type TestCase, type TestResult } from './junit';
import { retentionCutoff } from '../retention';

export const MAX_REPORT_BYTES = 20 * 1024 * 1024;

export class TestReportError extends Error {
  constructor(public status: number, message: string) { super(message); }
}

export interface TestReportSummary {
  id: number;
  path: string;
  tests: number;
  passed: number;
  failed: number;
  errors: number;
  skipped: number;
  /** When the run happened: the report file's mtime (ms). */
  ranAt: number;
  reportedAt: number;
  reportedBy: string;
  reportedByType: string;
}

export interface TestResultRow extends Omit<TestCase, 'durationMs'> {
  label: string;
  durationMs: number | null;
  ranAt: number;
  reportPath: string;
}

export interface IngestResult {
  report: TestReportSummary;
  /** Read before (the same bytes): nothing changed. */
  already: boolean;
  /** Up to 20 failing or erroring tests, each with the first line of why. */
  failing: Array<{ label: string; result: TestResult; message: string | null }>;
  truncated: boolean;
}

const keyOf = (c: Pick<TestCase, 'suite' | 'classname' | 'name'>) => JSON.stringify([c.suite ?? '', c.classname ?? '', c.name]);

function reportRow(r: unknown[]): TestReportSummary {
  return {
    id: Number(r[0]), path: String(r[1]), tests: Number(r[2]), passed: Number(r[3]), failed: Number(r[4]),
    errors: Number(r[5]), skipped: Number(r[6]), ranAt: Number(r[7]), reportedAt: Number(r[8]),
    reportedBy: String(r[9]), reportedByType: String(r[10]),
  };
}
const REPORT_COLS = 'id, path, tests, passed, failed, errors, skipped, ran_at, reported_at, reported_by, reported_by_type';

/**
 * Read a JUnit report inside `projectRoot` and keep each test's result.
 * `candidate` is the caller's path, absolute or relative to the project.
 */
export function ingestTestReport(
  projectRoot: string,
  candidate: string,
  by: { author: string; authorType: string },
  now = Date.now(),
): IngestResult {
  let target: string;
  try { target = resolveWithin(projectRoot, path.isAbsolute(candidate) ? candidate : path.join(projectRoot, candidate), 'test report'); } catch (err) {
    if (err instanceof ConfinementError) throw new TestReportError(400, `${candidate} is not a file inside this project.`);
    throw err;
  }
  let st: fs.Stats;
  try { st = fs.statSync(target); } catch { throw new TestReportError(404, `${candidate} does not exist.`); }
  if (!st.isFile()) throw new TestReportError(400, `${candidate} is not a file.`);
  if (st.size > MAX_REPORT_BYTES) throw new TestReportError(413, `${candidate} is larger than a test report can be (20 MB).`);
  let buf: Buffer;
  try { buf = readFileWithin(projectRoot, target, 'test report'); } catch (err) {
    if (err instanceof ConfinementError) throw new TestReportError(400, `${candidate} could not be read: ${err.message}`);
    throw err;
  }
  const parsed = parseJUnit(buf.toString('utf8'));
  if (!parsed) throw new TestReportError(422, `${candidate} is not a JUnit report. Most runners write one: vitest --reporter=junit, jest-junit, pytest --junitxml, go-junit-report, Playwright's junit reporter.`);
  const rel = path.relative(projectRoot, target).split(path.sep).join('/');
  const sha256 = crypto.createHash('sha256').update(buf).digest('hex');
  const failing = parsed.cases.filter((c) => c.result === 'failed' || c.result === 'error').slice(0, 20)
    .map((c) => ({ label: testLabel(c), result: c.result, message: c.message }));

  const db = getDb();
  const known = db.exec(`SELECT ${REPORT_COLS} FROM test_reports WHERE project_root = ? AND sha256 = ?`, [projectRoot, sha256])[0]?.values[0];
  if (known) return { report: reportRow(known), already: true, failing, truncated: parsed.truncated };

  const ranAt = Math.round(st.mtimeMs);
  const t = parsed.totals;
  db.run(
    `INSERT INTO test_reports (project_root, path, sha256, tests, passed, failed, errors, skipped, ran_at, reported_at, reported_by, reported_by_type)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [projectRoot, rel, sha256, t.tests, t.passed, t.failed, t.errors, t.skipped, ranAt, now, by.author, by.authorType],
  );
  const id = Number(db.exec('SELECT id FROM test_reports WHERE project_root = ? AND sha256 = ?', [projectRoot, sha256])[0].values[0][0]);
  // B8.4b: the report's own cases, for what the tests said at a past moment.
  // Kept as long as replay frames are.
  const cutoff = retentionCutoff(now);
  if (cutoff !== null) {
    db.run(
      'DELETE FROM test_report_cases WHERE report_id IN (SELECT id FROM test_reports WHERE project_root = ? AND reported_at < ?)',
      [projectRoot, cutoff],
    );
  }
  for (const c of parsed.cases) {
    db.run(
      `INSERT OR REPLACE INTO test_report_cases (report_id, test_key, suite, classname, name, file, result, duration_ms, message)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [id, keyOf(c), c.suite, c.classname, c.name, c.file, c.result, c.durationMs, c.message],
    );
  }
  for (const c of parsed.cases) {
    // An older run never overwrites a newer result.
    db.run(
      `INSERT INTO test_results (project_root, test_key, suite, classname, name, file, result, duration_ms, message, report_id, ran_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(project_root, test_key) DO UPDATE SET
         suite = excluded.suite, classname = excluded.classname, name = excluded.name, file = excluded.file,
         result = excluded.result, duration_ms = excluded.duration_ms, message = excluded.message,
         report_id = excluded.report_id, ran_at = excluded.ran_at
       WHERE excluded.ran_at >= test_results.ran_at`,
      [projectRoot, keyOf(c), c.suite, c.classname, c.name, c.file, c.result, c.durationMs, c.message, id, ranAt],
    );
  }
  markDirty();
  const report = reportRow(db.exec(`SELECT ${REPORT_COLS} FROM test_reports WHERE id = ?`, [id])[0].values[0]);
  // D1.5a: a new run is shared with teammates, where task state is.
  try { reportListener?.({ projectRoot, path: rel, ranAt, by, totals: t, cases: parsed.cases }); } catch (err) { console.warn('[Tests] sharing the run failed:', err); }
  return { report, already: false, failing, truncated: parsed.truncated };
}

export interface RecordedRun {
  projectRoot: string;
  /** The report, project-relative. */
  path: string;
  ranAt: number;
  by: { author: string; authorType: string };
  totals: { tests: number; passed: number; failed: number; errors: number; skipped: number };
  cases: TestCase[];
}
let reportListener: ((run: RecordedRun) => void) | undefined;
/** Told of each new run as it is recorded (not one read before). */
export function setReportListener(fn: ((run: RecordedRun) => void) | undefined): void { reportListener = fn; }

/**
 * The project's tests with their last results, failing first. `match`
 * narrows to tests whose file, class or suite contains it.
 */
export function listTestResults(projectRoot: string, opts: { match?: string; result?: TestResult; limit?: number } = {}): TestResultRow[] {
  const rows = getDb().exec(
    `SELECT r.suite, r.classname, r.name, r.file, r.result, r.duration_ms, r.message, r.ran_at, p.path
       FROM test_results r JOIN test_reports p ON p.id = r.report_id
      WHERE r.project_root = ?`,
    [projectRoot],
  )[0]?.values ?? [];
  const order: Record<string, number> = { error: 0, failed: 1, skipped: 2, passed: 3 };
  const m = opts.match?.toLowerCase();
  return rows
    .map((r) => {
      const c = { suite: r[0] as string | null, classname: r[1] as string | null, name: String(r[2]), file: r[3] as string | null };
      return {
        ...c, label: testLabel(c), result: r[4] as TestResult, durationMs: (r[5] as number | null) ?? null,
        message: (r[6] as string | null) ?? null, ranAt: Number(r[7]), reportPath: String(r[8]),
      };
    })
    .filter((t) => !opts.result || t.result === opts.result)
    .filter((t) => !m || [t.file, t.classname, t.suite].some((v) => v?.toLowerCase().includes(m)))
    .sort((a, b) => order[a.result] - order[b.result] || a.label.localeCompare(b.label))
    .slice(0, opts.limit ?? 500);
}

/**
 * Each test's result as it was known at `at` (B8.4b): from the reports
 * handed over by then, each test's newest run. A report from before its
 * cases were kept (B8.4b) answers with the results it still holds.
 */
export function testResultsAt(projectRoot: string, at: number): TestResultRow[] {
  const db = getDb();
  const reports = db.exec(
    'SELECT id, path, ran_at FROM test_reports WHERE project_root = ? AND reported_at <= ? ORDER BY ran_at, id',
    [projectRoot, at],
  )[0]?.values ?? [];
  const byKey = new Map<string, TestResultRow>();
  for (const [id, reportPath, ranAt] of reports) {
    let rows = db.exec(
      'SELECT test_key, suite, classname, name, file, result, duration_ms, message FROM test_report_cases WHERE report_id = ?',
      [id as number],
    )[0]?.values ?? [];
    if (rows.length === 0) {
      rows = db.exec(
        'SELECT test_key, suite, classname, name, file, result, duration_ms, message FROM test_results WHERE project_root = ? AND report_id = ?',
        [projectRoot, id as number],
      )[0]?.values ?? [];
    }
    for (const r of rows) {
      const c = { suite: r[1] as string | null, classname: r[2] as string | null, name: String(r[3]), file: r[4] as string | null };
      // Oldest run first, so a newer one replaces it.
      byKey.set(String(r[0]), {
        ...c, label: testLabel(c), result: r[5] as TestResult, durationMs: (r[6] as number | null) ?? null,
        message: (r[7] as string | null) ?? null, ranAt: Number(ranAt), reportPath: String(reportPath),
      });
    }
  }
  return [...byKey.values()];
}

/** The project's latest reports, newest run first. */
export function listTestReports(projectRoot: string, limit = 20): TestReportSummary[] {
  return (getDb().exec(`SELECT ${REPORT_COLS} FROM test_reports WHERE project_root = ? ORDER BY ran_at DESC, id DESC LIMIT ?`, [projectRoot, limit])[0]?.values ?? [])
    .map(reportRow);
}

/** "12 tests, 2 failing", across every test's last result. */
export function testsSummary(projectRoot: string): { tests: number; passed: number; failing: number; skipped: number; words: string } {
  const rows = getDb().exec('SELECT result, COUNT(*) FROM test_results WHERE project_root = ? GROUP BY result', [projectRoot])[0]?.values ?? [];
  const n = (r: string) => Number(rows.find((x) => x[0] === r)?.[1] ?? 0);
  const tests = rows.reduce((a, r) => a + Number(r[1]), 0);
  const failing = n('failed') + n('error');
  const words = tests === 0 ? 'No test results yet: an agent hands over a JUnit report with report_tests.'
    : `${tests} test${tests === 1 ? '' : 's'}, ${failing ? `${failing} failing` : 'none failing'}${n('skipped') ? `, ${n('skipped')} skipped` : ''}`;
  return { tests, passed: n('passed'), failing, skipped: n('skipped'), words };
}
