/**
 * CDev Phase 3.3 — cross-repo plan scope + pointer files.
 *
 * The home repo of a plan is the git origin URL of the project it was
 * created in. A plan can additionally declare *scope* — other repos
 * that participate in the same plan. Each scoped repo gets a thin
 * pointer file at `.codetrellis/external/<plan-uid>.yaml` advertising
 * the plan so developers cloning just that repo discover it.
 *
 * This test runs the round-trip end-to-end via the same MCP wire
 * format real agents use:
 *
 *   1. Configure a git origin on the fixture (home repo).
 *   2. Scan + create a plan → homeRepo populated from `git config`.
 *   3. add_plan_scope against a sibling tmp dir (simulating the
 *      scoped repo's local clone) → pointer YAML written there.
 *   4. list_plan_pointers from the sibling project → pointer visible.
 *   5. list_plans_by_repo on the home URL → plan returned with
 *      scope set; on the scoped URL → plan returned via scope.
 *   6. Export plan to disk → plan.yaml carries homeRepo + scope.
 *   7. remove_plan_scope → pointer file removed, list_plan_pointers
 *      empty again.
 *
 * If anything in this chain breaks, the cross-repo coordination story
 * (and the central-oversight deployment shape that depends on it) is
 * impacted.
 */

import { test, expect } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';
import { execSync } from 'node:child_process';
import { parse as parseYaml } from 'yaml';
import { setupHarness } from '../harness';

test.describe('CDev Phase 3.3 — cross-repo plan scope', () => {
  test.setTimeout(120_000);

  test('add scope writes pointer; round-trips through plan.yaml; remove cleans up', async () => {
    const h = await setupHarness('cdev-cross-repo');
    try {
      // 1. Give the fixture a deterministic git origin so homeRepo is
      // captured. The URL itself is fake — we never push.
      execSync('git remote add origin git@github.com:cdev-test/home-repo.git', {
        cwd: h.fixture.projectPath,
      });

      // Simulate a second repo on the same machine — a sibling tmp dir
      // with its own .git so addPlanScope's pointer_project_root has
      // a real target.
      const scopedRoot = path.join(h.fixture.tmpDir, 'scoped-app');
      fs.mkdirSync(scopedRoot, { recursive: true });
      execSync('git init -q', { cwd: scopedRoot });
      execSync('git remote add origin git@github.com:cdev-test/scoped-repo.git', {
        cwd: scopedRoot,
      });

      // 2. Scan + create the plan.
      await h.client.scanProject(h.fixture.projectPath);
      const agent = await h.spawnAgent({ agentType: 'claude-code', model: 'opus-4-7' });

      const createRes = await agent.callTool('create_plan', {
        title: 'Cross-repo plan',
        description: 'Touches both home and scoped repos.',
        project_path: h.fixture.projectPath,
      });
      const created = JSON.parse(createRes.text);
      const planUid: string = created.uid;
      expect(planUid).toBeTruthy();

      // get_plan doesn't expose homeRepo directly, so fetch raw via
      // the REST listing endpoint. The home repo URL should be the
      // normalised form of the SSH URL we set above.
      const allPlans = await h.client.raw('GET', `/api/plans?project=${encodeURIComponent(h.fixture.projectPath)}`);
      const allPlansJson = await allPlans.json();
      const ourPlan = allPlansJson.find((p: any) => p.uid === planUid);
      expect(ourPlan).toBeTruthy();
      expect(ourPlan.homeRepo).toBe('https://github.com/cdev-test/home-repo');
      expect(ourPlan.scope).toEqual([]);

      // 3. Add scope — pointer file should land in the scoped repo.
      const addRes = await agent.callTool('add_plan_scope', {
        plan_uid: planUid,
        repo_url: 'git@github.com:cdev-test/scoped-repo.git',
        pointer_project_root: scopedRoot,
        contribution: 'ships the migration',
        summary: 'High-level coordination plan spanning home + scoped repos',
      });
      const added = JSON.parse(addRes.text);
      expect(added.ok).toBe(true);
      expect(added.scope).toEqual(['https://github.com/cdev-test/scoped-repo']);
      expect(added.pointerPath).toBeTruthy();
      expect(fs.existsSync(added.pointerPath)).toBe(true);

      // Pointer file shape: validates parser-side defaulting.
      const pointerYaml = fs.readFileSync(added.pointerPath, 'utf-8');
      const pointer = parseYaml(pointerYaml);
      expect(pointer.planUid).toBe(planUid);
      expect(pointer.homeRepo).toBe('https://github.com/cdev-test/home-repo');
      expect(pointer.title).toBe('Cross-repo plan');
      expect(pointer.contribution).toBe('ships the migration');
      expect(pointer.summary).toBe('High-level coordination plan spanning home + scoped repos');
      expect(typeof pointer.cachedAt).toBe('number');

      // 4. list_plan_pointers from the scoped repo surfaces the pointer.
      //
      // The scoped repo has to be OPEN for this — Phase 30 / M34 confines a
      // tool naming a `project_path` to projects this app has opened, and
      // `list_plan_pointers` scans that directory for pointer files. The
      // comment above used to say the second repo need not be scanned,
      // which was true and was the finding: an agent could name any
      // directory on the machine and have it walked.
      //
      // Scopes are stored as repo URLs, not local paths, so there is no
      // stored record to derive this root from — the user genuinely has both
      // repos open when they work across them.
      await h.client.scanProject(scopedRoot);

      const listPointersRes = await agent.callTool('list_plan_pointers', {
        project_path: scopedRoot,
      });
      const pointers = JSON.parse(listPointersRes.text);
      expect(pointers.count).toBe(1);
      expect(pointers.pointers[0].planUid).toBe(planUid);
      expect(pointers.pointers[0].homeRepo).toBe('https://github.com/cdev-test/home-repo');

      // 5a. list_plans_by_repo on the home URL → plan returned.
      const byHomeRes = await agent.callTool('list_plans_by_repo', {
        repo_url: 'https://github.com/cdev-test/home-repo',
      });
      const byHome = JSON.parse(byHomeRes.text);
      expect(byHome.count).toBeGreaterThanOrEqual(1);
      expect(byHome.plans.find((p: any) => p.uid === planUid)).toBeTruthy();

      // 5b. list_plans_by_repo on the scoped URL (different form even —
      // SSH short) → still matches via the normaliser.
      const byScopedRes = await agent.callTool('list_plans_by_repo', {
        repo_url: 'git@github.com:cdev-test/scoped-repo.git',
      });
      const byScoped = JSON.parse(byScopedRes.text);
      expect(byScoped.count).toBeGreaterThanOrEqual(1);
      expect(byScoped.plans.find((p: any) => p.uid === planUid)).toBeTruthy();

      // 6. Export plan to disk → plan.yaml carries homeRepo + scope.
      await h.client.exportPlan(planUid, h.fixture.projectPath);
      // Plan directory is `<title-slug>-<uid-prefix>`; we look it up
      // generically rather than hard-coding the slug rule.
      const plansDir = path.join(h.fixture.projectPath, '.codetrellis', 'plans');
      const dirs = fs.readdirSync(plansDir).filter((d) => d.endsWith(planUid.split('-')[0]));
      expect(dirs.length).toBe(1);
      const planYamlPath = path.join(plansDir, dirs[0], 'plan.yaml');
      const planYaml = parseYaml(fs.readFileSync(planYamlPath, 'utf-8'));
      expect(planYaml.homeRepo).toBe('https://github.com/cdev-test/home-repo');
      expect(planYaml.scope).toEqual(['https://github.com/cdev-test/scoped-repo']);

      // 7. remove_plan_scope deletes the pointer; listing again is empty.
      const removeRes = await agent.callTool('remove_plan_scope', {
        plan_uid: planUid,
        repo_url: 'git@github.com:cdev-test/scoped-repo.git',
        pointer_project_root: scopedRoot,
      });
      const removed = JSON.parse(removeRes.text);
      expect(removed.ok).toBe(true);
      expect(removed.scope).toEqual([]);
      expect(removed.pointerRemoved).toBe(true);
      expect(fs.existsSync(added.pointerPath)).toBe(false);

      const listAfterRes = await agent.callTool('list_plan_pointers', {
        project_path: scopedRoot,
      });
      const listAfter = JSON.parse(listAfterRes.text);
      expect(listAfter.count).toBe(0);
    } finally {
      await h.teardown();
    }
  });
});
