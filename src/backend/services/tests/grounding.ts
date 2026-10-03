/**
 * Tests mapped to code (Phase 32 B8.2; observability doc §9).
 *
 * A test file covers the files it imports, directly or through a barrel:
 * the same import data the awareness engine uses (`importersOf`), so no
 * coverage tooling is needed. For a file, its tests are the last results of
 * every test whose file imports it, and it reads one of:
 *
 *  - ✗ failing: any of them failed or errored on its last run;
 *  - ⚠ tests older than the code: the file changed after the newest run of
 *    its tests, so a "passing" is about code that is no longer there. This
 *    is what catches "done" claimed on stale results (JOURNEYS J1);
 *  - ✓ passing;
 *  - ○ no tests: nothing with a result imports it.
 *
 * CodeTrellis runs nothing: these are what the runs handed over said.
 *
 * A teammate's run (D1.5a), read from their run record after a pull, counts
 * the same, and for each test file the newest run wins, here or theirs. It
 * is judged by commit: older than the code when the file or its test changed
 * since the commit the run was made on, or differed from it when it ran.
 */

import fs from 'node:fs';
import path from 'node:path';
import { importersOf } from '../importers';
import { getDb } from '../database';
import { resolveWithin } from '../confined-fs';
import { projectRelative } from '../trusted-roots';
import { listTestResults, testResultsAt, type TestResultRow } from './test-results';
import { listFrames } from '../replay-frames';
import { getSnapshot, type TrellisSnapshotData } from '../trellis-service';
import { changedSinceCommit, listTeammateRuns, type TeammateRun } from './teammate-runs';
import type { RunFile } from '../task-records/run-record';

export type GroundingState = 'failing' | 'stale' | 'passing' | 'untested';

export interface FileGrounding {
  /** Relative to the project root. */
  path: string;
  state: GroundingState;
  /** "✓ 12 tests passing", "⚠ tests older than the code: …". */
  words: string;
  /** The test files that import it, relative. */
  testFiles: string[];
  /** Each test, or for a teammate's run its failing tests and a count of the rest (`count`). */
  tests: Array<Pick<TestResultRow, 'label' | 'result' | 'message' | 'ranAt'> & { testFile: string; count?: number }>;
  /** When its newest test run happened (ms), or null. */
  lastRunAt: number | null;
  /** When the file last changed on disk (ms), or null when it is not there. */
  changedAt: number | null;
  /** The file is itself a test file with results. */
  isTest: boolean;
  /** When the newest run it rests on was a teammate's (D1.5a): whose, verified or not, and at which commit. */
  from: { who: string; verified: boolean; commit: string | null; at: number } | null;
}

export class NotAFileError extends Error {}

/** Changes within this of a run are the same moment (filesystem and runner clocks). */
const SLACK_MS = 2_000;

const looksLikeFile = (s: string | null): s is string => !!s && (/[\\/]/.test(s) || /\.[a-z]{1,5}$/i.test(s));

/** A result's test file, project-relative, from what the runner wrote. */
export function testFileOf(root: string, t: Pick<TestResultRow, 'file' | 'classname' | 'suite'>): string | null {
  const raw = [t.file, t.classname, t.suite].find(looksLikeFile);
  if (!raw) return null;
  const abs = path.isAbsolute(raw) ? raw : path.join(root, raw);
  const rel = projectRelative(root, abs);
  return rel.startsWith('..') || path.isAbsolute(rel) ? null : rel.split(path.sep).join('/');
}

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;

type Weighted = Pick<TestResultRow, 'result'> & { count?: number };

/** The words for a file's tests, pure: the state and its sentence. */
export function groundingWords(tests: ReadonlyArray<Weighted>, lastRunAt: number | null, changedAt: number | null): { state: GroundingState; words: string } {
  return wordsOf(tests, changedAt !== null && lastRunAt !== null && changedAt > lastRunAt + SLACK_MS);
}

/** The words, given whether the code changed after the tests ran. A teammate's run counts its passing tests in one entry. */
export function wordsOf(tests: ReadonlyArray<Weighted>, stale: boolean): { state: GroundingState; words: string } {
  const n = (t: Weighted) => t.count ?? 1;
  const total = tests.reduce((a, t) => a + n(t), 0);
  if (total === 0) return { state: 'untested', words: '○ no tests: no test with a reported result imports it' };
  const failing = tests.filter((t) => t.result === 'failed' || t.result === 'error').reduce((a, t) => a + n(t), 0);
  const ran = tests.filter((t) => t.result !== 'skipped').reduce((a, t) => a + n(t), 0);
  if (failing) return { state: 'failing', words: `✗ ${failing} of ${plural(total, 'test')} failing${stale ? ', and it changed after they ran' : ''}` };
  if (stale) return { state: 'stale', words: `⚠ tests older than the code: it changed after its ${plural(total, 'test')} last ran` };
  if (ran === 0) return { state: 'untested', words: `○ ${plural(total, 'test')}, all skipped` };
  return { state: 'passing', words: `✓ ${plural(ran, 'test')} passing` };
}

/** A teammate's run of one test file, as entries: each failing test, then the passing and skipped counted. */
function runEntries(run: TeammateRun, f: RunFile): FileGrounding['tests'] {
  const out: FileGrounding['tests'] = f.failing.map((x) => ({ label: x.name, result: x.result, message: x.why, ranAt: run.at, testFile: f.file }));
  // Failing tests beyond those named are counted, not listed.
  if (f.failed > f.failing.length) out.push({ label: `${f.failed - f.failing.length} more failing`, result: 'failed', message: null, ranAt: run.at, testFile: f.file, count: f.failed - f.failing.length });
  if (f.passed) out.push({ label: `${plural(f.passed, 'test')} passing`, result: 'passed', message: null, ranAt: run.at, testFile: f.file, count: f.passed });
  if (f.skipped) out.push({ label: `${plural(f.skipped, 'test')} skipped`, result: 'skipped', message: null, ranAt: run.at, testFile: f.file, count: f.skipped });
  return out;
}

/** One file's grounding. `candidate` is absolute or relative to the project. */
export function groundingOf(projectRoot: string, candidate: string, known?: TestResultRow[], knownRuns?: TeammateRun[]): FileGrounding {
  // resolveWithin answers with the realpath; the root is the path the project
  // was opened at. Under a link (macOS's /var and /tmp) a plain relative
  // between them is "../../private/…", and every file read "no tests".
  const abs = resolveWithin(projectRoot, path.isAbsolute(candidate) ? candidate : path.join(projectRoot, candidate), 'file');
  const rel = projectRelative(projectRoot, abs).split(path.sep).join('/');
  // A folder has no tests of its own; saying "no tests" of one would mislead.
  try { if (fs.lstatSync(abs).isDirectory()) throw new NotAFileError(`${rel || '.'} is a folder, not a file.`); } catch (err) { if (err instanceof NotAFileError) throw err; }
  const results = known ?? listTestResults(projectRoot, { limit: 100_000 });
  const runs = knownRuns ?? listTeammateRuns(projectRoot);
  const withFile = results.map((t) => ({ t, testFile: testFileOf(projectRoot, t) }));
  const isOwn = withFile.some((x) => x.testFile === rel) || runs.some((r) => r.files.some((f) => f.file === rel));
  let testFiles: string[];
  if (isOwn) {
    testFiles = [rel];
  } else {
    // Asked under the project's own root: the graph stores files as the
    // project was opened, and `abs` is the realpath.
    const importers = new Set(importersOf(path.join(projectRoot, rel)).map((i) => i.relativePath.split(path.sep).join('/')));
    const known = new Set<string>([...withFile.map((x) => x.testFile).filter((f): f is string => !!f), ...runs.flatMap((r) => r.files.map((f) => f.file))]);
    testFiles = [...known].filter((f) => importers.has(f)).sort();
  }
  let changedAt: number | null = null;
  try { changedAt = Math.round(fs.lstatSync(abs).mtimeMs); } catch { /* not on disk */ }

  // Each test file's newest run, here or a teammate's.
  const tests: FileGrounding['tests'] = [];
  let stale = false;
  let lastRunAt: number | null = null;
  let newestRun: TeammateRun | null = null;
  for (const tf of testFiles) {
    const local = withFile.filter((x) => x.testFile === tf);
    const localAt = local.length ? Math.max(...local.map((x) => x.t.ranAt)) : -Infinity;
    let best: { run: TeammateRun; file: RunFile } | null = null;
    for (const run of runs) {
      const f = run.files.find((x) => x.file === tf);
      if (f && run.at > localAt && (!best || run.at > best.run.at)) best = { run, file: f };
    }
    if (best) {
      tests.push(...runEntries(best.run, best.file));
      // By commit: the code or its test changed since, or differed when it ran.
      const since = best.run.commit ? changedSinceCommit(projectRoot, best.run.commit) : null;
      if (!since || since.has(rel) || since.has(tf) || best.run.dirty.includes(rel) || best.run.dirty.includes(tf)) stale = true;
      if (!newestRun || best.run.at > newestRun.at) newestRun = best.run;
      lastRunAt = Math.max(lastRunAt ?? 0, best.run.at);
    } else if (local.length) {
      tests.push(...local.map((x) => ({ label: x.t.label, result: x.t.result, message: x.t.message, ranAt: x.t.ranAt, testFile: tf })));
      if (changedAt !== null && changedAt > localAt + SLACK_MS) stale = true;
      lastRunAt = Math.max(lastRunAt ?? 0, localAt);
    }
  }
  const words = wordsOf(tests, stale);
  if (newestRun && tests.length) words.words += `, in ${newestRun.who}'s run at ${newestRun.commit ? newestRun.commit.slice(0, 7) : 'an unknown commit'}${newestRun.verified ? '' : ', unverified'}`;
  return {
    path: rel, state: words.state, words: words.words, testFiles: testFiles.filter((tf) => tests.some((t) => t.testFile === tf)),
    tests, lastRunAt, changedAt, isTest: isOwn,
    from: newestRun ? { who: newestRun.who, verified: newestRun.verified, commit: newestRun.commit, at: newestRun.at } : null,
  };
}

export interface GroundingMap {
  /** Each file some test reaches, project-relative, with its state and words. Any other file has no tests. */
  files: Record<string, Pick<FileGrounding, 'state' | 'words'>>;
  /** Whether the project has any reported results at all: without any, "no tests" says nothing. */
  hasResults: boolean;
  counts: Record<GroundingState, number>;
}

/** How deep a chain of barrels is followed from a test file. */
const MAX_BARRELS = 5;

/**
 * Every file's grounding at once, for the graph's overlay (B8.3a). The files
 * a test can reach are found forward, from each test file through what it
 * imports and on through barrels' re-exports; each of those is then asked
 * exactly as one file is (`groundingOf`), so the overlay and the Inspector
 * never disagree. A file no test can reach has none.
 */
export function groundingMap(projectRoot: string): GroundingMap {
  const results = listTestResults(projectRoot, { limit: 100_000 });
  const runs = listTeammateRuns(projectRoot);
  const counts: Record<GroundingState, number> = { failing: 0, stale: 0, passing: 0, untested: 0 };
  const files: GroundingMap['files'] = {};
  if (results.length === 0 && runs.length === 0) return { files, hasResults: false, counts };
  const testFiles = new Set([
    ...results.map((t) => testFileOf(projectRoot, t)).filter((f): f is string => !!f),
    ...runs.flatMap((r) => r.files.map((f) => f.file)),
  ]);
  const importsOf = (absFile: string): Array<{ path: string; reexport: boolean }> =>
    (getDb().exec(
      `SELECT i.resolved_path, i.is_reexport FROM imports i JOIN files f ON i.file_id = f.id
        WHERE f.path = ? AND i.resolved_path IS NOT NULL`,
      [absFile],
    )[0]?.values ?? []).map((r) => ({ path: String(r[0]), reexport: r[1] === 1 }));
  const candidates = new Set<string>(testFiles);
  for (const tf of testFiles) {
    const start = path.join(projectRoot, tf);
    const seen = new Set<string>([start]);
    let frontier = importsOf(start).map((i) => i.path);
    for (let depth = 0; depth <= MAX_BARRELS && frontier.length; depth++) {
      const next: string[] = [];
      for (const abs of frontier) {
        if (seen.has(abs)) continue;
        seen.add(abs);
        const rel = projectRelative(projectRoot, abs);
        if (rel.startsWith('..') || path.isAbsolute(rel)) continue;
        candidates.add(rel.split(path.sep).join('/'));
        // A barrel passes on what it re-exports: follow those, not its own imports.
        next.push(...importsOf(abs).filter((i) => i.reexport).map((i) => i.path));
      }
      frontier = next;
    }
  }
  for (const rel of candidates) {
    let g: FileGrounding;
    try { g = groundingOf(projectRoot, rel, results, runs); } catch { continue; }
    if (g.state === 'untested' && g.tests.length === 0) continue;
    files[rel] = { state: g.state, words: g.words };
    counts[g.state]++;
  }
  return { files, hasResults: true, counts };
}

export interface GroundingMapAt extends GroundingMap {
  at: number;
  /** When the graph shown for that moment was taken, or null when none was by then. */
  frameAt: number | null;
  /** Said when something live is not part of a past moment. */
  note: string | null;
}

/**
 * The overlay at a past moment (B8.4b, JOURNEYS J2): what the tests said by
 * `at`, on the graph as it was then. Its pieces are what was kept:
 *
 *  - the results: each test's newest run among the reports handed over by
 *    then (`testResultsAt`);
 *  - the files and imports: the replay frame at or before `at`, so a file
 *    added since is not there and one removed since is. Which imports are
 *    re-exports is read from the graph now (frames do not keep it), as a
 *    barrel rarely stops being one;
 *  - older than the code: a file whose content then differs from its content
 *    in the first frame taken at or after its tests' run (an agent edits,
 *    runs its tests, and its turn ends: that frame is the code the run was
 *    about). A change between the run and that frame is missed, never one
 *    invented; with no such frame by then, nothing is said.
 *
 * A teammate's run is left out: only their latest is kept, with no time it
 * arrived, so it cannot be placed at a past moment. The answer says so.
 */
export function groundingMapAt(projectRoot: string, at: number): GroundingMapAt {
  const counts: Record<GroundingState, number> = { failing: 0, stale: 0, passing: 0, untested: 0 };
  const files: GroundingMap['files'] = {};
  const note = listTeammateRuns(projectRoot).length > 0
    ? 'Teammates\' runs are shown live only: only their latest is kept, so a past moment counts the runs reported here.'
    : null;
  const frameBy = (t: number) => listFrames(projectRoot, { to: t, limit: 1, newestFirst: true })[0] ?? null;
  const frame = frameBy(at);
  const results = testResultsAt(projectRoot, at);
  if (results.length === 0) return { files, hasResults: false, counts, at, frameAt: frame?.at ?? null, note };
  if (!frame) return { files, hasResults: true, counts, at, frameAt: null, note };

  const graphs = new Map<number, TrellisSnapshotData | null>();
  const graphOf = (id: number) => {
    if (!graphs.has(id)) graphs.set(id, getSnapshot(id)?.data ?? null);
    return graphs.get(id)!;
  };
  const then = graphOf(frame.id);
  if (!then) return { files, hasResults: true, counts, at, frameAt: frame.at, note };
  const hashThen = new Map(then.files.map((f) => [f.path, f.contentHash]));
  const importsOf = new Map<string, string[]>();
  for (const e of then.edges) importsOf.set(e.source, [...(importsOf.get(e.source) ?? []), e.target]);
  const reexports = new Set((getDb().exec(
    `SELECT f.relative_path, t.relative_path FROM imports i JOIN files f ON i.file_id = f.id JOIN files t ON t.path = i.resolved_path
      WHERE i.is_reexport = 1`,
  )[0]?.values ?? []).map((r) => `${String(r[0]).split(path.sep).join('/')}\0${String(r[1]).split(path.sep).join('/')}`));

  // Each test file's results, and when it last ran.
  const byTestFile = new Map<string, TestResultRow[]>();
  for (const t of results) {
    const tf = testFileOf(projectRoot, t);
    if (tf) byTestFile.set(tf, [...(byTestFile.get(tf) ?? []), t]);
  }
  // The files each test file reaches: itself, what it imports, and on through barrels' re-exports.
  const reachedBy = new Map<string, Set<string>>();
  const reach = (file: string, tf: string) => reachedBy.set(file, (reachedBy.get(file) ?? new Set()).add(tf));
  for (const tf of byTestFile.keys()) {
    reach(tf, tf);
    const seen = new Set<string>([tf]);
    let frontier = (importsOf.get(tf) ?? []).map((target) => ({ from: tf, target }));
    for (let depth = 0; depth <= MAX_BARRELS && frontier.length; depth++) {
      const next: typeof frontier = [];
      for (const { target } of frontier) {
        if (seen.has(target)) continue;
        seen.add(target);
        reach(target, tf);
        next.push(...(importsOf.get(target) ?? []).filter((t) => reexports.has(`${target}\0${t}`)).map((t) => ({ from: target, target: t })));
      }
      frontier = next;
    }
  }

  for (const [file, testFiles] of reachedBy) {
    if (!hashThen.has(file)) continue;
    // A test file is its own: its results, not those of tests that import it.
    const own = byTestFile.has(file) ? [file] : [...testFiles].filter((tf) => tf !== file);
    const tests: Weighted[] = [];
    let stale = false;
    for (const tf of own) {
      const rows = byTestFile.get(tf) ?? [];
      tests.push(...rows);
      const ranAt = Math.max(...rows.map((r) => r.ranAt));
      const atRun = listFrames(projectRoot, { from: ranAt, to: frame.at, limit: 1 })[0] ?? null;
      const hashAtRun = atRun ? graphOf(atRun.id)?.files.find((f) => f.path === file)?.contentHash : undefined;
      if (hashAtRun !== undefined && hashAtRun !== hashThen.get(file)) stale = true;
    }
    const g = wordsOf(tests, stale);
    if (g.state === 'untested' && tests.length === 0) continue;
    files[file] = g;
    counts[g.state]++;
  }
  return { files, hasResults: true, counts, at, frameAt: frame.at, note };
}
