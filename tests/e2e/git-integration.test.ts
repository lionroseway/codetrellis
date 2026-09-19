/**
 * Git integration API tests.
 *
 * Exercises the REST endpoints that surface git state for the
 * branch popover, commit log, and working-tree status panels:
 *
 *   - GET /api/git/branch      — current branch name
 *   - GET /api/git/info        — branches, worktrees, hasCommits
 *   - GET /api/git/status      — staged / unstaged / untracked + HEAD hash
 *   - GET /api/git/head        — HEAD commit hash
 *   - GET /api/git/commits     — recent commit log
 *   - GET /api/git/branch-tip  — resolve a branch name to its tip SHA
 *
 * All endpoints are read-only, so the tests share a single harness
 * instance and run serially inside the describe block.
 */

import { test, expect } from '@playwright/test';
import { setupHarness, type Harness } from '../harness';

test.describe.serial('Git integration', () => {
  test.setTimeout(120_000);

  let h: Harness;
  let encodedPath: string;
  /** The branch the fixture was init'd on (always "main" per prepareFixture). */
  let currentBranch: string;

  test.beforeAll(async () => {
    h = await setupHarness('git-integration');
    encodedPath = encodeURIComponent(h.fixture.projectPath);
    // The git routes take the repository as `?path=` and run git with it
    // as `cwd`, so they are confined to opened projects (Phase 19).
    // Opening the fixture is what lets these tests exercise git at all.
    await h.client.scanProject(h.fixture.projectPath);
  });

  test.afterAll(async () => {
    await h?.teardown();
  });

  test('GET /api/git/branch returns the current branch', async () => {
    const res = await h.client.raw('GET', `/api/git/branch?path=${encodedPath}`);
    expect(res.ok).toBe(true);

    const body = await res.json() as { branch: string | null };
    expect(body.branch).toBeTruthy();
    // The fixture runs `git init -b main`, so this should be "main".
    expect(body.branch).toMatch(/^(main|master)$/);

    // Stash for later tests.
    currentBranch = body.branch!;
  });

  test('GET /api/git/info returns branches, worktrees, and hasCommits', async () => {
    const res = await h.client.raw('GET', `/api/git/info?path=${encodedPath}`);
    expect(res.ok).toBe(true);

    const body = await res.json() as {
      currentBranch: string | null;
      branches: string[];
      worktrees: Array<{ path: string; branch: string | null }>;
      hasCommits: boolean;
    };

    expect(body.currentBranch).toBe(currentBranch);
    expect(body.branches).toContain(currentBranch);
    expect(body.hasCommits).toBe(true);
    expect(Array.isArray(body.worktrees)).toBe(true);
  });

  test('GET /api/git/status returns commit hash and file arrays', async () => {
    const res = await h.client.raw('GET', `/api/git/status?path=${encodedPath}`);
    expect(res.ok).toBe(true);

    const body = await res.json() as {
      staged: unknown[];
      unstaged: unknown[];
      untracked: unknown[];
      commitHash: string | null;
      shortCommitHash: string | null;
    };

    // The fixture has at least one commit, so HEAD should be populated.
    expect(body.commitHash).toMatch(/^[a-f0-9]{40}$/);
    expect(body.shortCommitHash).toMatch(/^[a-f0-9]{7}$/);

    // File arrays should be defined (clean repo — all empty).
    expect(Array.isArray(body.staged)).toBe(true);
    expect(Array.isArray(body.unstaged)).toBe(true);
    expect(Array.isArray(body.untracked)).toBe(true);
  });

  test('GET /api/git/head returns commitHash matching status', async () => {
    const headRes = await h.client.raw('GET', `/api/git/head?path=${encodedPath}`);
    expect(headRes.ok).toBe(true);

    const head = await headRes.json() as {
      commitHash: string | null;
      shortCommitHash: string | null;
    };
    expect(head.commitHash).toMatch(/^[a-f0-9]{40}$/);
    expect(head.shortCommitHash).toMatch(/^[a-f0-9]{7}$/);

    // Cross-check: HEAD should equal the commitHash from /status.
    const statusRes = await h.client.raw('GET', `/api/git/status?path=${encodedPath}`);
    const status = await statusRes.json() as { commitHash: string | null };
    expect(head.commitHash).toBe(status.commitHash);
  });

  test('GET /api/git/commits returns at least 1 commit from the fixture', async () => {
    const res = await h.client.raw(
      'GET',
      `/api/git/commits?path=${encodedPath}&limit=5`,
    );
    expect(res.ok).toBe(true);

    const body = await res.json() as {
      commits: Array<{
        commitHash: string;
        shortCommitHash: string;
        subject: string;
        committedAt: string;
      }>;
    };

    expect(body.commits.length).toBeGreaterThanOrEqual(1);

    const first = body.commits[0];
    expect(first.commitHash).toMatch(/^[a-f0-9]{40}$/);
    expect(first.shortCommitHash).toMatch(/^[a-f0-9]{7}$/);
    expect(first.subject).toBeTruthy();
    expect(first.committedAt).toBeTruthy();
  });

  test('GET /api/git/branch-tip matches HEAD for current branch', async () => {
    const tipRes = await h.client.raw(
      'GET',
      `/api/git/branch-tip?path=${encodedPath}&branch=${encodeURIComponent(currentBranch)}`,
    );
    expect(tipRes.ok).toBe(true);

    const tip = await tipRes.json() as {
      commitHash: string | null;
      shortCommitHash: string | null;
    };
    expect(tip.commitHash).toMatch(/^[a-f0-9]{40}$/);
    expect(tip.shortCommitHash).toMatch(/^[a-f0-9]{7}$/);

    // The branch tip for the current branch should equal HEAD.
    const headRes = await h.client.raw('GET', `/api/git/head?path=${encodedPath}`);
    const head = await headRes.json() as { commitHash: string | null };
    expect(tip.commitHash).toBe(head.commitHash);
  });
});
