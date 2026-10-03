/**
 * Global setup for the E2E harness suite.
 *
 * Runs once before all tests to clean up stale tmp directories from
 * previous test runs that crashed before teardown could fire.
 *
 * The per-test `prepareFixture()` already wipes its own tmp dir if it
 * exists (handles re-runs of the same test). This global setup catches
 * *other* tests' leftovers — e.g. a different test crashed and never
 * called `teardown()`, leaving `tests/_tmp/<other-test>/` on disk.
 *
 * A folder whose process is still running belongs to another run on this
 * checkout and is left alone (see `tmpDirFor`).
 *
 * Safety: only removes directories under `tests/_tmp/`. That directory
 * is gitignored and exists solely for test working copies.
 */

import fs from 'node:fs';
import { TMP_ROOT, ownerOfTmpDir } from './harness/paths';

/** Whether a process is still running: a live run's folders are left alone. */
function alive(pid: number): boolean {
  try { process.kill(pid, 0); return true; } catch (err) { return (err as NodeJS.ErrnoException).code === 'EPERM'; }
}

export default function globalSetup(): void {
  if (!fs.existsSync(TMP_ROOT)) return;

  const entries = fs.readdirSync(TMP_ROOT);
  if (entries.length === 0) return;

  let removed = 0;
  for (const entry of entries) {
    const full = `${TMP_ROOT}/${entry}`;
    // Another run on this checkout, still going: not stale.
    const owner = ownerOfTmpDir(entry);
    if (owner !== null && owner !== process.pid && alive(owner)) continue;
    try {
      const stat = fs.statSync(full);
      if (stat.isDirectory()) {
        fs.rmSync(full, { recursive: true, force: true });
        removed++;
      }
    } catch {
      // Skip entries that can't be stat'd or removed
    }
  }

  if (removed > 0) {
    console.log(`[global-setup] Cleaned ${removed} stale test dir(s) from tests/_tmp/`);
  }
}
