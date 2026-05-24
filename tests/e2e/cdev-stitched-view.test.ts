/**
 * CDev Phase 3.5 — cross-repo stitched view.
 *
 * The "stitched" view stitches local plans together with external
 * pointers (plans whose home repo lives elsewhere). Each pointer is
 * resolved against the user's recent_projects DB so the UI knows
 * whether the home repo is locally available ("Open" affordance) or
 * not ("Not cloned — copy clone command").
 *
 * Scenario:
 *   1. Set up the home repo and a scoped repo as local clones (both
 *      added to recent_projects via scanProject).
 *   2. Create a plan in the home repo, scope it to the scoped repo's
 *      origin URL, write a pointer file into the scoped repo.
 *   3. Hit `/api/plans/stitched?project=<scoped>` — pointer must be
 *      visible AND resolved to the home repo's local path.
 *   4. Drop the home repo from recent_projects → pointer becomes
 *      unresolved.
 */

import { test, expect } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';
import { execSync } from 'node:child_process';
import { setupHarness } from '../harness';

test.describe('CDev Phase 3.5 — cross-repo stitched view', () => {
  test.setTimeout(120_000);

  test('stitched API exposes pointers and resolves them when home repo is locally available', async () => {
    const h = await setupHarness('cdev-stitched-view');
    try {
      // 1. Home repo gets an origin URL.
      execSync('git remote add origin git@github.com:cdev-test/stitched-home.git', {
        cwd: h.fixture.projectPath,
      });

      // 2. Sibling tmp dir for the scoped repo. Mirrors the harness
      //    fixture structure: a real git repo with one initial commit
      //    so scanProject can record it as a recent project with an
      //    origin URL.
      const scopedRoot = path.join(h.fixture.tmpDir, 'scoped-app');
      fs.mkdirSync(scopedRoot, { recursive: true });
      fs.writeFileSync(path.join(scopedRoot, 'README.md'), '# scoped\n', 'utf-8');
      const gitEnv = {
        ...process.env,
        GIT_AUTHOR_NAME: 'Stitched Tester',
        GIT_AUTHOR_EMAIL: 'stitched@cdev.example',
        GIT_COMMITTER_NAME: 'Stitched Tester',
        GIT_COMMITTER_EMAIL: 'stitched@cdev.example',
        GIT_AUTHOR_DATE: '2026-01-01T00:00:00Z',
        GIT_COMMITTER_DATE: '2026-01-01T00:00:00Z',
      };
      execSync('git init -q', { cwd: scopedRoot });
      execSync('git remote add origin git@github.com:cdev-test/stitched-scoped.git', { cwd: scopedRoot });
      execSync('git add -A && git commit -q -m "init"', { cwd: scopedRoot, env: gitEnv });

      // 3. Scan both projects so recent_projects has both origin URLs.
      await h.client.scanProject(h.fixture.projectPath);
      await h.client.scanProject(scopedRoot);

      const agent = await h.spawnAgent({ agentType: 'claude-code', model: 'opus-4-7' });

      // 4. Create the plan in the home repo, scope it to the scoped
      //    repo, write the pointer file into the scoped clone.
      const createRes = await agent.callTool('create_plan', {
        title: 'Stitched plan',
        description: 'spans both repos',
        project_path: h.fixture.projectPath,
      });
      const created = JSON.parse(createRes.text);
      const planUid: string = created.uid;

      await agent.callTool('add_plan_scope', {
        plan_uid: planUid,
        repo_url: 'git@github.com:cdev-test/stitched-scoped.git',
        pointer_project_root: scopedRoot,
        contribution: 'consumes the new endpoint',
      });

      // 5. Stitched API from the scoped side — pointer resolves.
      const stitchedRes = await h.client.raw('GET', `/api/plans/stitched?project=${encodeURIComponent(scopedRoot)}`);
      expect(stitchedRes.ok).toBe(true);
      const stitched = await stitchedRes.json();
      expect(stitched.ownOriginUrl).toBe('https://github.com/cdev-test/stitched-scoped');
      expect(stitched.pointers).toHaveLength(1);
      const ptr = stitched.pointers[0];
      expect(ptr.pointer.planUid).toBe(planUid);
      expect(ptr.pointer.homeRepo).toBe('https://github.com/cdev-test/stitched-home');
      expect(ptr.resolved).not.toBeNull();
      expect(ptr.resolved.projectPath).toBe(h.fixture.projectPath);

      // 6. Drop the home repo from recent_projects → pointer becomes
      //    unresolved. The pointer file on disk doesn't move; we just
      //    lose the local link.
      const deleteRes = await h.client.raw('DELETE', '/api/recent-projects', { projectPath: h.fixture.projectPath });
      expect(deleteRes.ok).toBe(true);

      const stitchedAfter = await (await h.client.raw('GET', `/api/plans/stitched?project=${encodeURIComponent(scopedRoot)}`)).json();
      expect(stitchedAfter.pointers).toHaveLength(1);
      expect(stitchedAfter.pointers[0].resolved).toBeNull();
    } finally {
      await h.teardown();
    }
  });
});
