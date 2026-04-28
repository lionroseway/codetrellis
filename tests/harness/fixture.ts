/**
 * Fixture lifecycle — clones the sample-app template into a tmp
 * working dir, runs `git init` so the diff engine has a HEAD to work
 * against, and tears the whole thing down on demand.
 *
 * Why clone instead of operate on the template in place: tests
 * mutate files (the scripted agent simulates code edits), so each
 * test needs its own isolated copy. The template stays pristine in
 * the source repo.
 */

import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { FIXTURE_TEMPLATE, tmpDirFor, slugify } from './paths';

export interface PreparedFixture {
  /** Absolute path to the cloned working copy (the "project" the harness opens). */
  projectPath: string;
  /** Absolute path to the per-test tmp parent (also holds the data dir). */
  tmpDir: string;
  /** Absolute path to use for `CODETRELLIS_DATA_DIR`. */
  dataDir: string;
  /** SHA of the initial commit in the fixture's git repo. */
  initialCommitSha: string;
  /** Tear it all down — removes the entire tmp dir. Safe to call twice. */
  cleanup(): void;
}

/**
 * Materialise the fixture for one test.
 *
 * Side-effects:
 *   1. Wipes `tests/.tmp/<testId>/` if it already exists (stale leftover).
 *   2. Copies `FIXTURE_TEMPLATE` → `tests/.tmp/<testId>/sample-app/`.
 *   3. Runs `git init` + `git add -A` + `git commit` inside the copy
 *      so the diff engine has a HEAD. Author is hard-coded to a
 *      stable identity so commit SHAs are reproducible across runs
 *      (modulo the timestamp, which the caller can override via env).
 *   4. Returns the paths the test needs + a cleanup function.
 *
 * The `cleanup()` returned does the inverse — `rm -rf` of the whole
 * tmp dir. The user explicitly asked for this lifecycle: "git init
 * and then delete it etccccc".
 */
export function prepareFixture(testName: string): PreparedFixture {
  const testId = slugify(testName);
  const tmpDir = tmpDirFor(testId);
  const projectPath = path.join(tmpDir, 'sample-app');
  const dataDir = path.join(tmpDir, 'data');

  // Wipe any stale state from a previous failed run.
  if (fs.existsSync(tmpDir)) {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }

  fs.mkdirSync(dataDir, { recursive: true });
  fs.mkdirSync(projectPath, { recursive: true });

  // Recursively copy the fixture template. We avoid `cp -r` for
  // cross-platform safety (Windows CI someday).
  copyDir(FIXTURE_TEMPLATE, projectPath);

  // Init git so the diff engine has a HEAD. We pin author + committer
  // identity + timestamp via env so the resulting SHA is stable
  // across runs from a clean checkout — useful for debugging
  // ("the fixture's initial commit is always X").
  const gitEnv = {
    ...process.env,
    GIT_AUTHOR_NAME: 'CodeTrellis Harness',
    GIT_AUTHOR_EMAIL: 'harness@codetrellis.local',
    GIT_COMMITTER_NAME: 'CodeTrellis Harness',
    GIT_COMMITTER_EMAIL: 'harness@codetrellis.local',
    GIT_AUTHOR_DATE: '2026-01-01T00:00:00Z',
    GIT_COMMITTER_DATE: '2026-01-01T00:00:00Z',
  };

  const git = (args: string[]): string =>
    execFileSync('git', args, { cwd: projectPath, env: gitEnv, encoding: 'utf-8' }).trim();

  git(['init', '-q', '-b', 'main']);
  git(['add', '-A']);
  git(['commit', '-q', '-m', 'Initial fixture commit']);
  const initialCommitSha = git(['rev-parse', 'HEAD']);

  let cleanedUp = false;
  const cleanup = () => {
    if (cleanedUp) return;
    cleanedUp = true;
    if (fs.existsSync(tmpDir)) {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  };

  return { projectPath, tmpDir, dataDir, initialCommitSha, cleanup };
}

/**
 * Recursive directory copy that skips `.git` directories. The
 * template won't have one (it's stored in the parent repo), but if
 * someone ever does a `git init` inside the template by mistake we
 * don't want to copy the result.
 */
function copyDir(src: string, dst: string): void {
  for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
    if (entry.name === '.git' || entry.name === 'node_modules') continue;
    const srcPath = path.join(src, entry.name);
    const dstPath = path.join(dst, entry.name);
    if (entry.isDirectory()) {
      fs.mkdirSync(dstPath, { recursive: true });
      copyDir(srcPath, dstPath);
    } else if (entry.isFile()) {
      fs.copyFileSync(srcPath, dstPath);
    }
    // Symlinks etc — skip; the fixture is plain files.
  }
}
