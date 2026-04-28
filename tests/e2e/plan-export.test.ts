/**
 * Plan-export round-trip tests — Phase 13 §A + §B.
 *
 * The auto-sync feature (write-through to `<project>/.codetrellis/plans/`
 * + chokidar watcher reading external edits back into the DB) is the
 * highest-risk feature shipped at "100%" with no automated coverage.
 * This file fills that gap.
 *
 * Three scenarios:
 *
 *  1. **Export** — create plan in DB, call `/api/plans/:uid/export`,
 *     assert the on-disk shape (plan.yaml at the root, tasks/ + phases/
 *     + docs/ subdirs, the right files inside).
 *
 *  2. **Import round-trip** — export, copy the plan dir somewhere
 *     "fresh", call `/api/plans/import`, assert the imported plan
 *     matches the source (UID, title, task count, task descriptions).
 *
 *  3. **Auto-sync from disk** — export, edit `plan.yaml` directly on
 *     disk, wait for chokidar to fire + the plan-file-watcher to
 *     reconcile, assert the DB picked up the change.
 */

import { test, expect } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';
import yaml from 'yaml';
import { setupHarness, waitFor, sleep } from '../harness';

test.describe('Plan export — Phase 13 §A round-trip', () => {
  test.setTimeout(120_000);

  test('export writes the canonical on-disk layout', async () => {
    const h = await setupHarness('plan-export-layout');
    try {
      await h.client.scanProject(h.fixture.projectPath);

      const plan = await h.client.createPlan({
        title: 'Export layout test',
        description: 'Smoke test for the on-disk plan layout',
        projectPath: h.fixture.projectPath,
        tasks: [
          { description: 'First task', affectedFiles: ['packages/web/src/api.ts'] },
          { description: 'Second task', affectedFiles: ['packages/shared/src/validators.ts'] },
        ],
      });

      const result = await h.client.exportPlan(plan.uid, h.fixture.projectPath);

      // Plan dir lives under `<project>/.codetrellis/plans/<slug>/`.
      expect(result.planDir).toContain('.codetrellis/plans/');
      expect(fs.existsSync(result.planDir)).toBe(true);
      expect(fs.existsSync(path.join(result.planDir, 'plan.yaml'))).toBe(true);
      expect(fs.existsSync(path.join(result.planDir, 'tasks'))).toBe(true);
      expect(fs.existsSync(path.join(result.planDir, 'phases'))).toBe(true);
      expect(fs.existsSync(path.join(result.planDir, 'docs'))).toBe(true);

      // Two tasks → two task files.
      const taskFiles = fs.readdirSync(path.join(result.planDir, 'tasks'));
      expect(taskFiles.filter((f) => f.endsWith('.yaml'))).toHaveLength(2);

      // plan.yaml parses + carries the right title.
      const planYaml = yaml.parse(fs.readFileSync(path.join(result.planDir, 'plan.yaml'), 'utf-8'));
      expect(planYaml.title).toBe('Export layout test');
      expect(planYaml.uid).toBe(plan.uid);

      // file-status endpoint reflects the link.
      const status = await h.client.getPlanFileStatus(plan.uid, h.fixture.projectPath);
      expect(status.linked).toBe(true);
      expect(status.planDir).toBe(result.planDir);
    } finally {
      await h.teardown();
    }
  });

  test('export → import round-trip preserves plan identity', async () => {
    const h = await setupHarness('plan-export-roundtrip');
    try {
      await h.client.scanProject(h.fixture.projectPath);

      // Source plan with three tasks + a description we can match.
      const source = await h.client.createPlan({
        title: 'Round-trip plan',
        description: 'Has three tasks',
        projectPath: h.fixture.projectPath,
        tasks: [
          { description: 'Alpha', affectedFiles: ['packages/web/src/api.ts'] },
          { description: 'Beta', affectedFiles: ['packages/shared/src/types.ts'] },
          { description: 'Gamma', affectedFiles: ['packages/web/src/UserList.tsx'] },
        ],
      });
      const sourceDetail = await h.client.getPlan(source.uid);

      // Export to disk.
      const exported = await h.client.exportPlan(source.uid, h.fixture.projectPath);

      // Copy the plan dir to a "fresh" location so the import isn't
      // a no-op against the existing on-disk + DB state.
      const transitDir = path.join(h.fixture.tmpDir, 'plan-transit');
      fs.cpSync(exported.planDir, transitDir, { recursive: true });

      // Wipe the in-DB plan so import has somewhere to go. Reuse the
      // unlink endpoint then drop the DB row directly via REST.
      await h.client.unlinkPlan(source.uid, h.fixture.projectPath);
      await h.client.raw('DELETE', `/api/plans/${source.uid}`);

      // Confirm it's gone before import.
      const afterDelete = await h.client.listPlans();
      expect(afterDelete.find((p) => p.uid === source.uid)).toBeUndefined();

      // Import from the copy.
      const imported = await h.client.importPlan(transitDir);
      expect(imported.plan.uid).toBe(source.uid);
      expect(imported.plan.title).toBe('Round-trip plan');

      // Imported plan should match source on identity-relevant fields.
      const imp = await h.client.getPlan(source.uid);
      expect(imp.tasks).toHaveLength(3);
      const sourceDescs = new Set(sourceDetail.tasks.map((t) => t.description));
      const importedDescs = new Set(imp.tasks.map((t) => t.description));
      expect(importedDescs).toEqual(sourceDescs);
    } finally {
      await h.teardown();
    }
  });

  test('editing plan.yaml on disk + explicit import reconciles into the DB', async () => {
    // Deterministic version of the auto-sync flow: instead of waiting
    // for chokidar to detect the change, we call `/api/plans/import`
    // explicitly. Verifies the format → DB direction of round-trip
    // without depending on watcher timing. The chokidar-driven path
    // is exercised separately below.
    const h = await setupHarness('plan-export-disk-edit-import');
    try {
      await h.client.scanProject(h.fixture.projectPath);
      const plan = await h.client.createPlan({
        title: 'Original title',
        projectPath: h.fixture.projectPath,
        tasks: [{ description: 'Initial task', affectedFiles: ['packages/web/src/api.ts'] }],
      });
      const exported = await h.client.exportPlan(plan.uid, h.fixture.projectPath);
      const planYamlPath = path.join(exported.planDir, 'plan.yaml');

      // Edit the title on disk.
      const parsed = yaml.parse(fs.readFileSync(planYamlPath, 'utf-8'));
      parsed.title = 'Edited from disk';
      fs.writeFileSync(planYamlPath, yaml.stringify(parsed), 'utf-8');

      // Trigger the import explicitly (bypassing chokidar).
      const reimport = await h.client.importPlan(exported.planDir);
      expect(reimport.plan.uid).toBe(plan.uid);
      expect(reimport.plan.title).toBe('Edited from disk');

      // DB should now reflect the new title.
      const fresh = await h.client.getPlan(plan.uid);
      expect(fresh.title).toBe('Edited from disk');
    } finally {
      await h.teardown();
    }
  });

  // Chokidar-driven auto-sync (Phase 13 §B). The "agent edits a
  // YAML directly and the UI updates without a re-scan" UX claim.
  //
  // Was flaky (~30 %) until Apr 28: chokidar v4's `awaitWriteFinish`
  // + `ignoreInitial: true` against a watched dir whose first write
  // happens shortly after `watch()` has timing edges that bucket
  // the first writes as "initial" and drop them. Fixed by
  // pre-creating `<project>/.codetrellis/plans/` inside
  // `startPlanFileWatcher()` so chokidar always binds to a real,
  // empty directory.
  test(
    'chokidar auto-detects on-disk plan edits (Phase 13 §B)',
    async () => {
      const h = await setupHarness('plan-export-autosync-chokidar');
      try {
        // No need to pre-mkdir from the test side anymore — the
        // backend does it as part of `startPlanFileWatcher` (called
        // from `scanProject`).
        await h.client.scanProject(h.fixture.projectPath);

        const plan = await h.client.createPlan({
          title: 'Original',
          projectPath: h.fixture.projectPath,
          tasks: [{ description: 'Task', affectedFiles: ['packages/web/src/api.ts'] }],
        });
        const exported = await h.client.exportPlan(plan.uid, h.fixture.projectPath);
        const planYamlPath = path.join(exported.planDir, 'plan.yaml');

        // Wait beyond the SELF_WRITE_TTL_MS (1s) so our edit isn't
        // mistaken for a self-write the export just stamped.
        await sleep(1500);

        const parsed = yaml.parse(fs.readFileSync(planYamlPath, 'utf-8'));
        parsed.title = 'Edited from disk';
        const edited = yaml.stringify(parsed);
        fs.writeFileSync(planYamlPath, edited, 'utf-8');

        await waitFor(
          async () => {
            const fresh = await h.client.getPlan(plan.uid);
            return fresh.title === 'Edited from disk' ? fresh : null;
          },
          { timeoutMs: 10_000, intervalMs: 200, description: 'auto-sync via chokidar' },
        );
      } finally {
        await h.teardown();
      }
    },
  );
});
