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
 * Safety: only removes directories under `tests/_tmp/`. That directory
 * is gitignored and exists solely for test working copies.
 */

import fs from 'node:fs';
import { TMP_ROOT } from './harness/paths';

export default function globalSetup(): void {
  if (!fs.existsSync(TMP_ROOT)) return;

  const entries = fs.readdirSync(TMP_ROOT);
  if (entries.length === 0) return;

  let removed = 0;
  for (const entry of entries) {
    const full = `${TMP_ROOT}/${entry}`;
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
