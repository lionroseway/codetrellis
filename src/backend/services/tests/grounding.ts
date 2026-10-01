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
 */

import fs from 'node:fs';
import path from 'node:path';
import { importersOf } from '../importers';
import { getDb } from '../database';
import { resolveWithin } from '../confined-fs';
import { listTestResults, type TestResultRow } from './test-results';

export type GroundingState = 'failing' | 'stale' | 'passing' | 'untested';

export interface FileGrounding {
  /** Relative to the project root. */
  path: string;
  state: GroundingState;
  /** "✓ 12 tests passing", "⚠ tests older than the code: …". */
  words: string;
  /** The test files that import it, relative. */
  testFiles: string[];
  tests: Array<Pick<TestResultRow, 'label' | 'result' | 'message' | 'ranAt'> & { testFile: string }>;
  /** When its newest test run happened (ms), or null. */
  lastRunAt: number | null;
  /** When the file last changed on disk (ms), or null when it is not there. */
  changedAt: number | null;
  /** The file is itself a test file with results. */
  isTest: boolean;
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
  const rel = path.relative(root, abs);
  return rel.startsWith('..') || path.isAbsolute(rel) ? null : rel.split(path.sep).join('/');
}

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;

/** The words for a file's tests, pure: the state and its sentence. */
export function groundingWords(tests: ReadonlyArray<Pick<TestResultRow, 'result'>>, lastRunAt: number | null, changedAt: number | null): { state: GroundingState; words: string } {
  if (tests.length === 0) return { state: 'untested', words: '○ no tests: no test with a reported result imports it' };
  const failing = tests.filter((t) => t.result === 'failed' || t.result === 'error').length;
  const ran = tests.filter((t) => t.result !== 'skipped').length;
  const stale = changedAt !== null && lastRunAt !== null && changedAt > lastRunAt + SLACK_MS;
  if (failing) return { state: 'failing', words: `✗ ${failing} of ${plural(tests.length, 'test')} failing${stale ? ', and it changed after they ran' : ''}` };
  if (stale) return { state: 'stale', words: `⚠ tests older than the code: it changed after its ${plural(tests.length, 'test')} last ran` };
  if (ran === 0) return { state: 'untested', words: `○ ${plural(tests.length, 'test')}, all skipped` };
  return { state: 'passing', words: `✓ ${plural(ran, 'test')} passing` };
}

/** One file's grounding. `candidate` is absolute or relative to the project. */
export function groundingOf(projectRoot: string, candidate: string, known?: TestResultRow[]): FileGrounding {
  const abs = resolveWithin(projectRoot, path.isAbsolute(candidate) ? candidate : path.join(projectRoot, candidate), 'file');
  const rel = path.relative(projectRoot, abs).split(path.sep).join('/');
  // A folder has no tests of its own; saying "no tests" of one would mislead.
  try { if (fs.lstatSync(abs).isDirectory()) throw new NotAFileError(`${rel || '.'} is a folder, not a file.`); } catch (err) { if (err instanceof NotAFileError) throw err; }
  const results = known ?? listTestResults(projectRoot, { limit: 100_000 });
  const withFile = results.map((t) => ({ t, testFile: testFileOf(projectRoot, t) }));
  const own = withFile.filter((x) => x.testFile === rel);
  let covering: typeof withFile;
  let testFiles: string[];
  if (own.length) {
    covering = own;
    testFiles = [rel];
  } else {
    const importers = new Set(importersOf(abs).map((i) => i.relativePath.split(path.sep).join('/')));
    covering = withFile.filter((x) => x.testFile !== null && importers.has(x.testFile));
    testFiles = [...new Set(covering.map((x) => x.testFile!))].sort();
  }
  let changedAt: number | null = null;
  try { changedAt = Math.round(fs.lstatSync(abs).mtimeMs); } catch { /* not on disk */ }
  const lastRunAt = covering.length ? Math.max(...covering.map((x) => x.t.ranAt)) : null;
  const { state, words } = groundingWords(covering.map((x) => x.t), lastRunAt, changedAt);
  return {
    path: rel, state, words, testFiles,
    tests: covering.map((x) => ({ label: x.t.label, result: x.t.result, message: x.t.message, ranAt: x.t.ranAt, testFile: x.testFile! })),
    lastRunAt, changedAt, isTest: own.length > 0,
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
  const counts: Record<GroundingState, number> = { failing: 0, stale: 0, passing: 0, untested: 0 };
  const files: GroundingMap['files'] = {};
  if (results.length === 0) return { files, hasResults: false, counts };
  const testFiles = new Set(results.map((t) => testFileOf(projectRoot, t)).filter((f): f is string => !!f));
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
        const rel = path.relative(projectRoot, abs);
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
    try { g = groundingOf(projectRoot, rel, results); } catch { continue; }
    if (g.state === 'untested' && g.tests.length === 0) continue;
    files[rel] = { state: g.state, words: g.words };
    counts[g.state]++;
  }
  return { files, hasResults: true, counts };
}
