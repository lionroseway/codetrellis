/**
 * CDev Phase 3.6 — central-oversight deployment shape.
 *
 * Confirms the central-oversight shape works on the existing
 * primitives (Phase 3.3 scope + 3.5 stitched view) plus the new
 * `repoRole` hint, with no special-case code.
 *
 * Scenario:
 *   1. Set up a "planning" repo (no source code, just .codetrellis/).
 *   2. Set up a "code" repo. Tag it `repoRole: "code"` via project
 *      config.
 *   3. From the planning repo, create a plan; scope it to the code
 *      repo. Pointer file lands in the code repo's .codetrellis/external/.
 *   4. Hit the stitched API from the code repo's side — the pointer
 *      is visible and resolved (planning repo is in recent_projects).
 *   5. Read the code repo's project config and confirm `repoRole`
 *      round-tripped through git.
 */

import { test, expect } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';
import { execSync } from 'node:child_process';
import { setupHarness } from '../harness';

test.describe('CDev Phase 3.6 — central-oversight deployment shape', () => {
  test.setTimeout(120_000);

  test('planning repo + code repo (repoRole) stitch together via pointer files', async () => {
    const h = await setupHarness('cdev-central-oversight');
    try {
      // 1. Use the harness fixture as the "planning" repo. Tag origin
      //    + repoRole so it advertises itself as the planning hub.
      execSync('git remote add origin git@github.com:cdev-test/oversight-plans.git', {
        cwd: h.fixture.projectPath,
      });

      await h.client.scanProject(h.fixture.projectPath);
      const agent = await h.spawnAgent({ agentType: 'claude-code', model: 'opus-4-7' });
      await agent.callTool('update_project_config', {
        project_root: h.fixture.projectPath,
        repoRole: 'planning',
      });

      // Round-trip: the config file should now declare planning.
      const planningCfg = JSON.parse(
        fs.readFileSync(path.join(h.fixture.projectPath, '.codetrellis', 'config.json'), 'utf-8'),
      );
      expect(planningCfg.repoRole).toBe('planning');

      // 2. Spin up a code repo as a sibling tmp dir with its own git origin.
      const codeRoot = path.join(h.fixture.tmpDir, 'code-svc');
      fs.mkdirSync(codeRoot, { recursive: true });
      fs.writeFileSync(path.join(codeRoot, 'README.md'), '# code-svc\n', 'utf-8');
      const gitEnv = {
        ...process.env,
        GIT_AUTHOR_NAME: 'Oversight Tester',
        GIT_AUTHOR_EMAIL: 'oversight@cdev.example',
        GIT_COMMITTER_NAME: 'Oversight Tester',
        GIT_COMMITTER_EMAIL: 'oversight@cdev.example',
        GIT_AUTHOR_DATE: '2026-01-01T00:00:00Z',
        GIT_COMMITTER_DATE: '2026-01-01T00:00:00Z',
      };
      execSync('git init -q', { cwd: codeRoot });
      execSync('git remote add origin git@github.com:cdev-test/oversight-code-svc.git', { cwd: codeRoot });
      execSync('git add -A && git commit -q -m "init"', { cwd: codeRoot, env: gitEnv });

      await h.client.scanProject(codeRoot);
      await agent.callTool('update_project_config', {
        project_root: codeRoot,
        repoRole: 'code',
      });
      const codeCfg = JSON.parse(
        fs.readFileSync(path.join(codeRoot, '.codetrellis', 'config.json'), 'utf-8'),
      );
      expect(codeCfg.repoRole).toBe('code');

      // 3. Author the plan in the planning repo; scope it to the
      //    code repo with the pointer landing in the code repo's
      //    .codetrellis/external/.
      const createRes = await agent.callTool('create_plan', {
        title: 'Ship 2FA',
        description: 'Spans the planning hub and code-svc',
        project_path: h.fixture.projectPath,
      });
      const plan = JSON.parse(createRes.text);
      const planUid: string = plan.uid;

      await agent.callTool('add_plan_scope', {
        plan_uid: planUid,
        repo_url: 'git@github.com:cdev-test/oversight-code-svc.git',
        pointer_project_root: codeRoot,
        contribution: 'ships the API surface',
      });

      const pointerPath = path.join(codeRoot, '.codetrellis', 'external', `${planUid}.yaml`);
      expect(fs.existsSync(pointerPath)).toBe(true);

      // 4. Stitched API from the code-repo side — pointer is visible
      //    AND resolved (planning repo is in recent_projects).
      const stitched = await (await h.client.raw('GET', `/api/plans/stitched?project=${encodeURIComponent(codeRoot)}`)).json();
      expect(stitched.pointers).toHaveLength(1);
      expect(stitched.pointers[0].pointer.homeRepo).toBe('https://github.com/cdev-test/oversight-plans');
      expect(stitched.pointers[0].resolved).not.toBeNull();
      expect(stitched.pointers[0].resolved.projectPath).toBe(h.fixture.projectPath);

      // 5. Confirm the code repo's project-config endpoint reports
      //    repoRole=code — this is what the frontend uses to soften
      //    the "no plans here" copy.
      const codeCfgRes = await h.client.raw('GET', `/api/project-config?project=${encodeURIComponent(codeRoot)}`);
      const codeCfgJson = await codeCfgRes.json();
      expect(codeCfgJson.repoRole).toBe('code');

      // And the planning side reports repoRole=planning.
      const planningCfgJson = await (await h.client.raw('GET', `/api/project-config?project=${encodeURIComponent(h.fixture.projectPath)}`)).json();
      expect(planningCfgJson.repoRole).toBe('planning');
    } finally {
      await h.teardown();
    }
  });
});
