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
export function groundingOf(projectRoot: string, candidate: string): FileGrounding {
  const abs = resolveWithin(projectRoot, path.isAbsolute(candidate) ? candidate : path.join(projectRoot, candidate), 'file');
  const rel = path.relative(projectRoot, abs).split(path.sep).join('/');
  // A folder has no tests of its own; saying "no tests" of one would mislead.
  try { if (fs.lstatSync(abs).isDirectory()) throw new NotAFileError(`${rel || '.'} is a folder, not a file.`); } catch (err) { if (err instanceof NotAFileError) throw err; }
  const results = listTestResults(projectRoot, { limit: 100_000 });
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
