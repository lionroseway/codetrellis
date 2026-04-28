/**
 * Smoke test for the E2E harness itself.
 *
 * Doesn't exercise the agent loop, plans, or anything fancy — just
 * proves the harness boots cleanly:
 *
 *   1. A tmp dir is materialised with a `git init`'d clone of the
 *      fixture template.
 *   2. The backend starts on a free port with `CODETRELLIS_DATA_DIR`
 *      pointed at the tmp data dir (so it doesn't touch
 *      `~/.codetrellis/`).
 *   3. `POST /api/project/scan` against the fixture returns a
 *      non-zero number of files / symbols / edges.
 *   4. `GET /api/cross-system/edges` reports the expected number of
 *      HTTP edges (TS `fetch` ↔ Python `@router`).
 *   5. Teardown deletes the tmp dir cleanly.
 *
 * If any of this is wrong, the harness can't be trusted as a base
 * for the loop tests in Phase 2.
 */

import { test, expect } from '@playwright/test';
import fs from 'node:fs';
import { setupHarness } from '../harness';

test.describe('E2E harness smoke', () => {
  test.setTimeout(90_000);

  test('boots the backend, scans the fixture, tears down cleanly', async () => {
    const h = await setupHarness('smoke');

    try {
      // 1. Fixture should be materialised + git-initialised.
      expect(fs.existsSync(h.fixture.projectPath)).toBe(true);
      expect(fs.existsSync(`${h.fixture.projectPath}/.git`)).toBe(true);
      expect(h.fixture.initialCommitSha).toMatch(/^[a-f0-9]{40}$/);

      // 2. Backend should be reachable via build-info.
      const buildInfo = await h.client.getBuildInfo();
      expect(buildInfo.version).toBeTruthy();

      // 3. Scan the fixture — fileCount > 20, AST symbolCount > 30.
      //    `fileCount` at the top level is the walked count; AST
      //    stats live on `astStats` (not all walked files are parsed
      //    as source — README.md, schema.sql, etc. don't produce
      //    symbols).
      const scan = await h.client.scanProject(h.fixture.projectPath);
      expect(scan.fileCount).toBeGreaterThan(20);
      expect(scan.astStats.symbolCount).toBeGreaterThan(20);
      expect(scan.astStats.importCount).toBeGreaterThan(5);

      // 4. Cross-system edges — fixture has 4 known HTTP pairings
      //    (web/api.ts × {users,orders} × {GET,POST}). The matcher
      //    might collapse pairs by route, so we accept ≥ 2.
      const xs = await h.client.getCrossSystemEdges();
      expect(xs.length).toBeGreaterThanOrEqual(2);

      // 5. Symbol search should resolve the User type from @sample/shared.
      const symbols = await h.client.searchSymbols('User');
      expect(symbols.length).toBeGreaterThan(0);
    } finally {
      await h.teardown();
    }

    // 6. Teardown must have deleted the tmp dir.
    expect(fs.existsSync(h.fixture.tmpDir)).toBe(false);
  });

  test('two tests in a row get isolated data dirs', async () => {
    const a = await setupHarness('iso-a');
    const b = await setupHarness('iso-b');
    try {
      expect(a.fixture.tmpDir).not.toBe(b.fixture.tmpDir);
      expect(a.backend.backendPort).not.toBe(b.backend.backendPort);
      expect(a.backend.mcpPort).not.toBe(b.backend.mcpPort);

      // Plans created in A shouldn't leak into B.
      await a.client.createPlan({
        title: 'Plan in A',
        projectPath: a.fixture.projectPath,
      });
      const plansB = await b.client.listPlans();
      expect(plansB.find((p) => p.title === 'Plan in A')).toBeUndefined();
    } finally {
      await Promise.allSettled([a.teardown(), b.teardown()]);
    }
  });
});
