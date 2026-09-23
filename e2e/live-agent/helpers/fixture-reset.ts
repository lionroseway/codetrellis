/**
 * Fixture reset utility for live-agent tests.
 *
 * Provides both:
 * - resetFixture(): cheap git-checkout reset of the shared fixture
 * - createTempFixture() / cleanupTempFixture(): isolated per-test copy
 *   for tests that modify fixture files and run in parallel
 */

import { execSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { authHeaders } from '../../helpers/setup';

/** Root of the codetrellis repo (parent of e2e/). */
const REPO_ROOT = path.resolve(__dirname, '..', '..', '..');

/** Absolute path to the shared fixture repo. */
export const FIXTURE_PATH = path.join(REPO_ROOT, 'tests', 'fixtures', 'sample-app');

/**
 * Reset the shared fixture repo to a clean git state.
 * Cheap and idempotent — just checks out the committed version.
 * May fail silently under parallel git contention.
 */
export function resetFixture(): void {
  for (let attempt = 0; attempt < 5; attempt++) {
    try {
      const lockPath = path.join(REPO_ROOT, '.git', 'index.lock');
      try { fs.unlinkSync(lockPath); } catch { /* not present */ }

      execSync('git checkout HEAD -- tests/fixtures/sample-app', {
        cwd: REPO_ROOT,
        stdio: 'pipe',
        timeout: 5000,
      });
      return;
    } catch {
      if (attempt < 4) {
        const base = 200 * Math.pow(2, attempt);
        const jitter = Math.floor(Math.random() * 300);
        execSync(`sleep ${(base + jitter) / 1000}`, { stdio: 'pipe' });
      }
    }
  }
  console.warn('resetFixture: could not reset after 5 attempts — continuing anyway');
}

/**
 * Create an isolated copy of the fixture for a test that modifies files.
 * Returns the temp path. Call cleanupTempFixture() in afterEach.
 */
export function createTempFixture(): string {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ct-fixture-'));
  execSync(`cp -R "${FIXTURE_PATH}/." "${tmpDir}/"`, { stdio: 'pipe' });
  return tmpDir;
}

/**
 * A temp fixture the app has OPENED.
 *
 * Paths the API and MCP tools act on are confined to opened projects
 * (Phase 19), and a fresh mkdtemp copy is not one: seeding a plan in it
 * got a 403, and create_plan got an MCP refusal the spec then tried to
 * JSON.parse. Opening is a scan, the same call the app makes.
 */
export async function openTempFixture(): Promise<string> {
  const dir = createTempFixture();
  const headers = { 'Content-Type': 'application/json', ...authHeaders() };
  // A scan that arrives while another is running (a previous test's scan
  // of the whole repo, still going server-side) answers 200 but serves the
  // file tree only and records nothing, so the copy is still not open.
  // Confirm it reached the opened list; retry while the other scan ends.
  for (let attempt = 0; attempt < 30; attempt++) {
    await fetch('http://localhost:3001/api/project/scan', {
      method: 'POST',
      headers,
      body: JSON.stringify({ projectPath: dir }),
    });
    const recents = await (await fetch('http://localhost:3001/api/recent-projects', { headers })).json();
    const list: Array<{ path?: string }> = Array.isArray(recents) ? recents : recents?.projects ?? [];
    if (list.some((p) => p.path === dir)) return dir;
    await new Promise((r) => setTimeout(r, 2000));
  }
  throw new Error(`could not open temp fixture ${dir}: never appeared among opened projects`);
}

/**
 * Remove a temp fixture created by createTempFixture.
 */
export function cleanupTempFixture(tmpPath: string): void {
  try {
    fs.rmSync(tmpPath, { recursive: true, force: true });
  } catch { /* best effort */ }
}

/**
 * Verify the fixture repo exists and has expected files.
 */
export function fixtureExists(): boolean {
  try {
    return fs.existsSync(path.join(FIXTURE_PATH, 'packages/web/src/api.ts'));
  } catch {
    return false;
  }
}
