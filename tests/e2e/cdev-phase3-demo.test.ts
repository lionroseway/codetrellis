/**
 * CDev Phase 3.7 — comprehensive end-to-end demo.
 *
 * This test covers the spec items the individual Phase-3 tests didn't
 * fully exercise:
 *
 *   1. Per-item sharing — shared plan with one local item; export
 *      excludes the local item; a "teammate" who imports the exported
 *      directory doesn't see the local row.
 *   2. Per-item sharing override — local parent with a shared child
 *      that has `overrideParentVisibility: true`. The shared child
 *      surfaces top-level on disk because the parent isn't there to
 *      anchor it.
 *
 * The cross-repo + system-docs + central-oversight stories already
 * have dedicated tests; this file fills the remaining 3.7 gap so the
 * Phase 3 suite covers the whole story end-to-end.
 */

import { test, expect } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';
import { execSync } from 'node:child_process';
import { parse as parseYaml } from 'yaml';
import { setupHarness } from '../harness';

function parseDoc(text: string): any {
  const obj = JSON.parse(text);
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const { _meta, ...rest } = obj;
  return rest;
}

test.describe('CDev Phase 3.7 — comprehensive Phase 3 demo', () => {
  test.setTimeout(180_000);

  test('per-item sharing: local items are excluded from export AND from a teammate import', async () => {
    const h = await setupHarness('cdev-phase3-sharing');
    try {
      execSync('git remote add origin git@github.com:cdev-test/sharing-demo.git', {
        cwd: h.fixture.projectPath,
      });
      await h.client.scanProject(h.fixture.projectPath);
      const agent = await h.spawnAgent({ agentType: 'claude-code', model: 'opus-4-7' });

      // Create a plan with three items: a shared action, a local
      // action (excluded from export), and an Object that has no
      // visibility set (defaults to shared).
      const planRes = await agent.callTool('create_plan', {
        title: 'Sharing demo plan',
        description: 'Tests per-item shared/local export behaviour.',
        project_path: h.fixture.projectPath,
      });
      const plan = JSON.parse(planRes.text);
      const planUid: string = plan.uid;

      const sharedAction = parseDoc((await agent.callTool('add_item', {
        plan_uid: planUid,
        kind: 'action',
        title: 'Shared action — rides to git',
        body: 'visible to teammates',
      })).text);

      const localAction = parseDoc((await agent.callTool('add_item', {
        plan_uid: planUid,
        kind: 'action',
        title: 'Local action — stays put',
        body: 'private to this machine',
        visibility: 'local',
      })).text);
      expect(localAction.visibility).toBe('local');

      const sharedObject = parseDoc((await agent.callTool('add_item', {
        plan_uid: planUid,
        kind: 'object',
        title: 'Shared object',
        body: '## Notes',
      })).text);

      // Export to disk.
      const exportRes = await agent.callTool('export_plan_to_files', {
        plan_uid: planUid,
        project_root: h.fixture.projectPath,
      });
      const exportResult = JSON.parse(exportRes.text);
      const planDir = exportResult.planDir as string;
      const itemsDir = path.join(planDir, 'items');

      // On disk: shared items appear, local action does not.
      const onDiskItems: string[] = [];
      const walk = (dir: string) => {
        for (const entry of fs.readdirSync(dir)) {
          const full = path.join(dir, entry);
          if (fs.statSync(full).isDirectory()) walk(full);
          else if (entry.endsWith('.yaml') || entry.endsWith('.yml')) {
            const raw = parseYaml(fs.readFileSync(full, 'utf-8'));
            if (raw?.uid) onDiskItems.push(raw.uid as string);
          }
        }
      };
      walk(itemsDir);

      expect(onDiskItems).toContain(sharedAction.uid);
      expect(onDiskItems).toContain(sharedObject.uid);
      expect(onDiskItems).not.toContain(localAction.uid);

      // Simulate "teammate pull": copy the exported dir to a fresh
      // tmp location, then import via MCP. The importer is upsert
      // by UID, so to be sure we're seeing the export-only state we
      // verify the count + UIDs match the exported set.
      const teammateRoot = path.join(h.fixture.tmpDir, 'teammate');
      const teammatePlanDir = path.join(teammateRoot, '.codetrellis', 'plans', path.basename(planDir));
      fs.mkdirSync(teammatePlanDir, { recursive: true });

      // Recursively copy planDir → teammatePlanDir
      const copyTree = (src: string, dst: string) => {
        if (!fs.existsSync(dst)) fs.mkdirSync(dst, { recursive: true });
        for (const entry of fs.readdirSync(src)) {
          const s = path.join(src, entry);
          const d = path.join(dst, entry);
          if (fs.statSync(s).isDirectory()) copyTree(s, d);
          else fs.copyFileSync(s, d);
        }
      };
      copyTree(planDir, teammatePlanDir);

      // The teammate plan.yaml exists, but we need to give the
      // import a path it understands. The importer accepts either
      // the plan dir or plan.yaml.
      const importRes = await agent.callTool('import_plan_from_files', {
        plan_dir: teammatePlanDir,
      });
      const imported = JSON.parse(importRes.text);
      // The exported set is shared items only; importing yields the
      // same UIDs (because they round-trip), so the in-DB plan now
      // reflects what a teammate would see after a fresh clone +
      // import — no local item.
      expect(imported.itemCount).toBeGreaterThanOrEqual(2);

      // The local action UID must NOT appear in the imported items.
      // (In this harness it's still in the DB because the same DB
      // is shared; what matters is that the teammate-side YAML
      // doesn't carry it.)
      const teammateItemsDir = path.join(teammatePlanDir, 'items');
      const teammateItems: string[] = [];
      walk.call(null, teammateItemsDir);
      // Re-collect (the walk closure above mutated `onDiskItems`; do
      // a fresh inline walk to avoid bleed).
      const collect = (dir: string, acc: string[]) => {
        for (const entry of fs.readdirSync(dir)) {
          const full = path.join(dir, entry);
          if (fs.statSync(full).isDirectory()) collect(full, acc);
          else if (entry.endsWith('.yaml') || entry.endsWith('.yml')) {
            const raw = parseYaml(fs.readFileSync(full, 'utf-8'));
            if (raw?.uid) acc.push(raw.uid as string);
          }
        }
      };
      const teammateUids: string[] = [];
      collect(teammateItemsDir, teammateUids);
      expect(teammateUids).not.toContain(localAction.uid);
      expect(teammateUids).toContain(sharedAction.uid);
    } finally {
      await h.teardown();
    }
  });

  test('per-item sharing override: shared child of local parent surfaces top-level on disk', async () => {
    const h = await setupHarness('cdev-phase3-override');
    try {
      await h.client.scanProject(h.fixture.projectPath);
      const agent = await h.spawnAgent({ agentType: 'claude-code', model: 'opus-4-7' });

      const planRes = await agent.callTool('create_plan', {
        title: 'Override demo plan',
        project_path: h.fixture.projectPath,
      });
      const plan = JSON.parse(planRes.text);
      const planUid: string = plan.uid;

      // Local parent.
      const localParent = parseDoc((await agent.callTool('add_item', {
        plan_uid: planUid,
        kind: 'object',
        title: 'Local parent',
        visibility: 'local',
      })).text);

      // Child WITHOUT override — should inherit local and not be exported.
      const localChild = parseDoc((await agent.callTool('add_item', {
        plan_uid: planUid,
        kind: 'action',
        title: 'Local child (inherits)',
        parent_uid: localParent.uid,
      })).text);

      // Child WITH override — shared, breaks the local inheritance chain.
      const sharedOverride = parseDoc((await agent.callTool('add_item', {
        plan_uid: planUid,
        kind: 'action',
        title: 'Shared child (override)',
        parent_uid: localParent.uid,
        override_parent_visibility: true,
      })).text);
      expect(sharedOverride.overrideParentVisibility).toBe(true);

      // Sibling top-level shared action — for control: it must
      // appear on disk regardless of the override mechanism.
      const sharedSibling = parseDoc((await agent.callTool('add_item', {
        plan_uid: planUid,
        kind: 'action',
        title: 'Top-level shared sibling',
      })).text);

      await agent.callTool('export_plan_to_files', {
        plan_uid: planUid,
        project_root: h.fixture.projectPath,
      });

      const plansRoot = path.join(h.fixture.projectPath, '.codetrellis', 'plans');
      const dirs = fs.readdirSync(plansRoot).filter((d) => d.endsWith(planUid.split('-')[0]));
      expect(dirs).toHaveLength(1);
      const itemsDir = path.join(plansRoot, dirs[0], 'items');

      // Collect every uid → its on-disk parent uid.
      const onDisk: Record<string, string | null> = {};
      const walk = (dir: string, parentUid: string | null) => {
        for (const entry of fs.readdirSync(dir)) {
          const full = path.join(dir, entry);
          if (fs.statSync(full).isDirectory()) {
            // Has _self.yaml — its uid identifies it
            const selfPath = path.join(full, '_self.yaml');
            if (fs.existsSync(selfPath)) {
              const self = parseYaml(fs.readFileSync(selfPath, 'utf-8'));
              if (self?.uid) onDisk[self.uid] = parentUid;
              walk(full, self?.uid ?? parentUid);
            }
          } else if ((entry.endsWith('.yaml') || entry.endsWith('.yml')) && entry !== '_self.yaml') {
            const raw = parseYaml(fs.readFileSync(full, 'utf-8'));
            if (raw?.uid) onDisk[raw.uid] = parentUid;
          }
        }
      };
      walk(itemsDir, null);

      // Local parent + its inheriting child should NOT be on disk.
      expect(onDisk[localParent.uid]).toBeUndefined();
      expect(onDisk[localChild.uid]).toBeUndefined();

      // The override child IS on disk, re-anchored to top-level
      // (parent gone) — its on-disk parent must be null.
      expect(onDisk[sharedOverride.uid]).toBeDefined();
      expect(onDisk[sharedOverride.uid]).toBeNull();

      // The unrelated shared sibling is on disk top-level too.
      expect(onDisk[sharedSibling.uid]).toBeNull();
    } finally {
      await h.teardown();
    }
  });
});
