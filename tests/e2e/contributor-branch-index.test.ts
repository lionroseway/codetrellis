/**
 * Preparing a contributor branch must not touch work the user has staged.
 *
 * The commit used to be `git commit -m <msg> --allow-empty`, with no
 * pathspec, so it committed the whole index — and the index survives
 * `git checkout -b`. A user who had staged an unrelated source change got it
 * committed onto the contributor branch, and the `git checkout -` at the end
 * then returned the worktree to the original branch's HEAD, silently
 * reverting the edit. Two harms from one missing argument: their work
 * disappeared from the branch they were working on, and the branch they were
 * told to hand to an outside collaborator carried unrelated in-progress
 * source.
 *
 * The existing precondition does not catch it — it is scoped to
 * `.codetrellis/`, so a clean manifest with a dirty index sails through, and
 * the modal's "this is refused rather than guessed at" was only true of the
 * manifest.
 */

import { test, expect } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { setupHarness } from '../harness';

const GIT_ENV = {
  ...process.env,
  GIT_AUTHOR_NAME: 'Harness',
  GIT_AUTHOR_EMAIL: 'harness@codetrellis.local',
  GIT_COMMITTER_NAME: 'Harness',
  GIT_COMMITTER_EMAIL: 'harness@codetrellis.local',
};

const git = (cwd: string, ...args: string[]): string =>
  execFileSync('git', args, { cwd, env: GIT_ENV, encoding: 'utf-8' });

test.describe('Contributor branch leaves the index alone', () => {
  test.setTimeout(120_000);

  test('an unrelated staged change is neither committed nor reverted', async () => {
    const h = await setupHarness('contrib-branch-index');
    const root = h.fixture.projectPath;
    try {
      await h.client.scanProject(root);

      // A plan with an exported manifest is what the branch is built from.
      const plan = await h.client.createPlan({ title: 'Shareable plan', projectPath: root });
      const exportRes = await h.client.raw(
        'POST',
        `/api/plans/${encodeURIComponent(plan.uid)}/export?path=${encodeURIComponent(root)}`,
      );
      expect(exportRes.ok).toBe(true);
      const { planDir } = (await exportRes.json()) as { planDir: string };
      const planSlug = path.basename(planDir);

      // Commit the manifest so `.codetrellis/` is clean — the precondition the
      // service actually checks. The index below is the part it never saw.
      git(root, 'add', '.codetrellis/');
      git(root, 'commit', '-m', 'add plan manifest');

      // The user stages an unrelated source change and has not committed it.
      const target = path.join(root, 'packages', 'shared', 'src', 'types.ts');
      const original = fs.readFileSync(target, 'utf-8');
      const edited = `${original}\n// work in progress, staged but not committed\n`;
      fs.writeFileSync(target, edited, 'utf-8');
      git(root, 'add', 'packages/shared/src/types.ts');

      const branchBefore = git(root, 'rev-parse', '--abbrev-ref', 'HEAD').trim();

      const res = await h.client.raw('POST', '/api/contributor-branch', {
        projectPath: root,
        planSlug,
        branchName: 'contrib/harness-test',
      });
      expect(res.ok).toBe(true);

      // Back where we started.
      expect(git(root, 'rev-parse', '--abbrev-ref', 'HEAD').trim()).toBe(branchBefore);

      // 1. The edit is still on disk. Before the fix this read as `original`,
      //    because checkout reverted it to the branch's HEAD.
      expect(fs.readFileSync(target, 'utf-8')).toBe(edited);

      // 2. And still staged. Before the fix `git status` was clean — the work
      //    had moved to a commit on a branch the user was never told about.
      expect(git(root, 'status', '--porcelain').trim()).toMatch(/^M\s+packages\/shared\/src\/types\.ts$/m);

      // 3. The contributor branch carries the manifest and nothing else.
      const touched = git(root, 'show', '--name-only', '--format=', 'contrib/harness-test')
        .split('\n')
        .map((l) => l.trim())
        .filter(Boolean);
      expect(touched.every((f) => f.startsWith('.codetrellis/'))).toBe(true);
      expect(touched).not.toContain('packages/shared/src/types.ts');
    } finally {
      await h.teardown();
    }
  });
});
