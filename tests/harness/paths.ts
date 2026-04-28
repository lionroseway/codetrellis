/**
 * Filesystem constants for the E2E harness.
 *
 * The harness has three kinds of path:
 *   - **Repo root** — where this test file lives.
 *   - **Fixture template** — `tests/fixtures/sample-app/` — pristine,
 *     committed source-of-truth. Tests never modify it directly.
 *   - **Tmp working copies** — `tests/.tmp/<test-id>/...` — one per
 *     test, holds a clone of the fixture (with its own `.git/`) plus
 *     the backend's data dir. Created in setup, deleted in teardown.
 */

import path from 'node:path';

// Playwright compiles tests to CJS, so `__dirname` is provided by the
// runtime. We don't need the ESM `import.meta.url` dance — keep this
// resilient to either compilation target by walking up from the
// file's directory.
//
// `__dirname` here is `<repo>/tests/harness`. Two levels up = repo root.
declare const __dirname: string;

/** Absolute path to the repo root (one level above `tests/`). */
export const REPO_ROOT = path.resolve(__dirname, '..', '..');

/** Pristine fixture template — never written to. */
export const FIXTURE_TEMPLATE = path.resolve(REPO_ROOT, 'tests', 'fixtures', 'sample-app');

/** Parent of all per-test working dirs. Gitignored. */
export const TMP_ROOT = path.resolve(REPO_ROOT, 'tests', '.tmp');

/**
 * Compose a path inside a test's tmp dir. `testId` should be a
 * filesystem-safe slug — typically `expect.getState().currentTestName`
 * passed through `slugify()`.
 */
export function tmpDirFor(testId: string): string {
  return path.resolve(TMP_ROOT, testId);
}

export function slugify(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 60);
}
