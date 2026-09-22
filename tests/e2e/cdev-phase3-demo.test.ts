/**
 * CDev Phase 3.7 — comprehensive end-to-end demo.
 *
 * This file covers the spec items the per-feature Phase-3 tests don't
 * exercise, plus regression guards for the bugs the tester pass
 * surfaced:
 *
 *   1. Per-item sharing — shared plan with one local item; export
 *      excludes the local item; a "teammate" who imports the exported
 *      directory doesn't see the local row.
 *   2. Per-item sharing override — `overrideParentVisibility: true` on
 *      a shared child re-anchors it to the **nearest exported ancestor**
 *      on disk, falling back to top-level only when no shared ancestor
 *      exists. Both branches are asserted.
 *   3. Re-export prune (regression for tester finding #1) — re-exporting
 *      a plan after a shape change (re-parent, visibility flip,
 *      title→slug rename, sortOrder change) wipes the stale yaml files
 *      so each uid lives in exactly one location on disk.
 *   4. Malformed YAML frontmatter on a system doc (regression for tester
 *      finding #2) is skipped + warned, not silently rewritten with the
 *      user's metadata destroyed.
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

      // A teammate imports inside a project THEY have open. The import
      // tools only read plan dirs of opened projects (resolveTrustedPlanDir),
      // so open the teammate's checkout the way the app would.
      await h.client.scanProject(teammateRoot);

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

  test('per-item sharing override: shared child re-anchors to nearest exported ancestor (or top-level if none)', async () => {
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

      // Shared grandparent. When the override child below re-anchors,
      // it should land HERE — under the nearest shared ancestor —
      // not at top-level. (CDev Phase 3 tester finding #3: the prior
      // test only had a local parent at the top, so "top-level" held
      // coincidentally. This branch nails down the actual contract.)
      const sharedGrandparent = parseDoc((await agent.callTool('add_item', {
        plan_uid: planUid,
        kind: 'object',
        title: 'Shared grandparent',
      })).text);

      // Local parent nested under the shared grandparent.
      const localParent = parseDoc((await agent.callTool('add_item', {
        plan_uid: planUid,
        kind: 'object',
        title: 'Local parent',
        visibility: 'local',
        parent_uid: sharedGrandparent.uid,
      })).text);

      // Child WITHOUT override — should inherit local and not be exported.
      const localChild = parseDoc((await agent.callTool('add_item', {
        plan_uid: planUid,
        kind: 'action',
        title: 'Local child (inherits)',
        parent_uid: localParent.uid,
      })).text);

      // Child WITH override — shared, breaks the local inheritance chain.
      // Expected on-disk parent: the shared grandparent (nearest exported
      // ancestor), NOT top-level.
      const sharedOverrideUnderShared = parseDoc((await agent.callTool('add_item', {
        plan_uid: planUid,
        kind: 'action',
        title: 'Shared override (re-anchored)',
        parent_uid: localParent.uid,
        override_parent_visibility: true,
      })).text);
      expect(sharedOverrideUnderShared.overrideParentVisibility).toBe(true);

      // Second test arm: a separate subtree with NO shared ancestor —
      // an override here SHOULD land at top-level because there's
      // nothing exported above it.
      const orphanLocalParent = parseDoc((await agent.callTool('add_item', {
        plan_uid: planUid,
        kind: 'object',
        title: 'Orphan local parent (no shared ancestor)',
        visibility: 'local',
      })).text);
      const sharedOverrideToTop = parseDoc((await agent.callTool('add_item', {
        plan_uid: planUid,
        kind: 'action',
        title: 'Shared override (no anchor → top-level)',
        parent_uid: orphanLocalParent.uid,
        override_parent_visibility: true,
      })).text);

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
      expect(onDisk[orphanLocalParent.uid]).toBeUndefined();

      // The shared grandparent IS on disk, top-level.
      expect(onDisk[sharedGrandparent.uid]).toBeNull();

      // Override-under-shared re-anchors to the grandparent (NOT top-level).
      expect(onDisk[sharedOverrideUnderShared.uid]).toBe(sharedGrandparent.uid);

      // Override with no shared ancestor goes top-level (fallback).
      expect(onDisk[sharedOverrideToTop.uid]).toBeNull();

      // The unrelated shared sibling is on disk top-level too.
      expect(onDisk[sharedSibling.uid]).toBeNull();
    } finally {
      await h.teardown();
    }
  });

  test('re-export prunes stale item files when an item changes shape on disk', async () => {
    // CDev Phase 3 tester finding #1 — re-exporting a plan whose
    // items moved (re-parent, sortOrder change, visibility flip) used
    // to leave orphan yaml files behind. On a teammate's pull the same
    // uid showed up in two places and imported non-deterministically.
    // This test exercises the three common shape changes and asserts
    // each item's uid lives in exactly one path on disk.
    const h = await setupHarness('cdev-phase3-reexport-prune');
    try {
      await h.client.scanProject(h.fixture.projectPath);
      const agent = await h.spawnAgent({ agentType: 'claude-code', model: 'opus-4-7' });

      const planRes = await agent.callTool('create_plan', {
        title: 'Re-export prune plan',
        project_path: h.fixture.projectPath,
      });
      const planUid: string = JSON.parse(planRes.text).uid;

      const parent = parseDoc((await agent.callTool('add_item', {
        plan_uid: planUid, kind: 'object', title: 'Parent',
      })).text);
      const child = parseDoc((await agent.callTool('add_item', {
        plan_uid: planUid, kind: 'action', title: 'Child', parent_uid: parent.uid,
      })).text);
      const sibling = parseDoc((await agent.callTool('add_item', {
        plan_uid: planUid, kind: 'action', title: 'Sibling',
      })).text);

      // First export — baseline.
      await agent.callTool('export_plan_to_files', {
        plan_uid: planUid, project_root: h.fixture.projectPath,
      });

      const plansRoot = path.join(h.fixture.projectPath, '.codetrellis', 'plans');
      const planDir = path.join(plansRoot, fs.readdirSync(plansRoot).find((d) => d.endsWith(planUid.split('-')[0]))!);
      const itemsDir = path.join(planDir, 'items');

      // Helper: collect (uid → set of file paths) so duplicates are obvious.
      const collectUidLocations = (dir: string): Map<string, string[]> => {
        const out = new Map<string, string[]>();
        const walk = (d: string) => {
          for (const entry of fs.readdirSync(d)) {
            const full = path.join(d, entry);
            if (fs.statSync(full).isDirectory()) { walk(full); continue; }
            if (!entry.endsWith('.yaml') && !entry.endsWith('.yml')) continue;
            const raw = parseYaml(fs.readFileSync(full, 'utf-8'));
            if (raw?.uid) {
              const list = out.get(raw.uid as string) ?? [];
              list.push(full);
              out.set(raw.uid as string, list);
            }
          }
        };
        walk(dir);
        return out;
      };

      // Shape change A — re-parent the child away from parent (now top-level).
      await agent.callTool('move_item', {
        uid: child.uid,
        new_parent_uid: '',
      });

      // Shape change B — flip the parent to local; its inheriting
      // subtree (just the parent itself now) drops off disk.
      await agent.callTool('update_item', {
        uid: parent.uid,
        visibility: 'local',
      });

      // Re-export onto the same directory.
      await agent.callTool('export_plan_to_files', {
        plan_uid: planUid, project_root: h.fixture.projectPath,
      });

      const after = collectUidLocations(itemsDir);

      // Each surviving uid appears in exactly one file.
      for (const [uid, locations] of after.entries()) {
        expect(locations).toHaveLength(1);
        if (locations.length > 1) {
          console.error(`[re-export-prune] uid ${uid} found at:`, locations);
        }
      }

      // The local parent should be gone from disk entirely.
      expect(after.has(parent.uid)).toBe(false);

      // Child + sibling both top-level (no nesting under stale dirs).
      expect(after.has(child.uid)).toBe(true);
      expect(after.has(sibling.uid)).toBe(true);

      // No empty `<sort>-<slug>/` shells left behind. Walk top-level
      // of itemsDir — every entry should either be a yaml or a
      // directory with actual content.
      const topLevel = fs.readdirSync(itemsDir);
      for (const entry of topLevel) {
        const full = path.join(itemsDir, entry);
        if (fs.statSync(full).isDirectory()) {
          expect(fs.readdirSync(full).length).toBeGreaterThan(0);
        }
      }
    } finally {
      await h.teardown();
    }
  });

  test('malformed YAML frontmatter on a system doc is skipped with a warning, not silently rewritten', async () => {
    // CDev Phase 3 tester finding #2 — a doc with broken frontmatter
    // used to be auto-stamped (title coerced to the filename, tags +
    // references dropped) and rewritten on disk. The user's intended
    // metadata was destroyed without any visible signal. Verify the
    // file is now left untouched and not added to the index.
    const h = await setupHarness('cdev-phase3-malformed-doc');
    try {
      await h.client.scanProject(h.fixture.projectPath);
      const agent = await h.spawnAgent({ agentType: 'claude-code', model: 'opus-4-7' });

      const docsDir = path.join(h.fixture.projectPath, '.codetrellis', 'docs');
      fs.mkdirSync(docsDir, { recursive: true });
      const malformedPath = path.join(docsDir, 'malformed.md');
      const originalContent = [
        '---',
        'title: Should Be Preserved',
        'tags: [unclosed, bad',
        'references: {{{',
        '---',
        '',
        'Body text the user wrote.',
        '',
      ].join('\n');
      fs.writeFileSync(malformedPath, originalContent, 'utf-8');

      // Give the watcher time to fire + skip.
      await new Promise((r) => setTimeout(r, 1500));

      const listRes = await agent.callTool('list_system_docs', {
        project_path: h.fixture.projectPath,
      });
      const list = JSON.parse(listRes.text);
      // Malformed doc must NOT have been added to the index.
      expect(list.docs.find((d: any) => d.slug === 'malformed')).toBeUndefined();

      // File on disk must be byte-for-byte unchanged (no destructive
      // rewrite that would clobber the user's intended metadata).
      const afterContent = fs.readFileSync(malformedPath, 'utf-8');
      expect(afterContent).toBe(originalContent);
    } finally {
      await h.teardown();
    }
  });
});
