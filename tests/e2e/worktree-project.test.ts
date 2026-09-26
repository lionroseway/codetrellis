/**
 * A linked git worktree opened as a project (Phase 32 §0.4a).
 *
 * Parallel agents in worktrees is the case Phase 32 is built around, and
 * in a linked worktree `.git` is a FILE pointing at the real git dir, not
 * a directory. Several routes read `.git/HEAD`, `.git/MERGE_HEAD` or
 * wrote into `.git/` by path, so from a worktree they reported no branch,
 * "no commits", never saw a merge conflict, and could not commit. The
 * existing git tests only ever open the main checkout.
 *
 * Every assertion here is made from INSIDE the linked worktree.
 */

import { test, expect } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { setupHarness, type Harness } from '../harness';

const BRANCH = 'feature/wt';

function git(cwd: string, ...args: string[]): string {
  return execFileSync('git', ['-c', 'user.email=t@t', '-c', 'user.name=t', ...args], {
    cwd,
    encoding: 'utf-8',
    stdio: ['ignore', 'pipe', 'pipe'],
  });
}

test.describe.serial('A linked worktree opened as a project', () => {
  test.setTimeout(120_000);

  let h: Harness;
  let main: string;
  let wt: string;
  let q: string;

  test.beforeAll(async () => {
    h = await setupHarness('worktree-project');
    main = h.fixture.projectPath;
    wt = path.join(h.fixture.tmpDir, 'sample-app-wt');
    git(main, 'worktree', 'add', '-q', '-b', BRANCH, wt);
    expect(fs.statSync(path.join(wt, '.git')).isFile()).toBe(true);
    await h.client.scanProject(wt);
    q = encodeURIComponent(wt);
  });

  test.afterAll(async () => {
    await h?.teardown();
  });

  test('the current branch is the worktree\'s own', async () => {
    const res = await h.client.raw('GET', `/api/git/branch?path=${q}`);
    expect(res.ok).toBe(true);
    expect(((await res.json()) as { branch: string | null }).branch).toBe(BRANCH);
  });

  test('the recent-projects entry records that branch', async () => {
    const res = await h.client.raw('GET', '/api/recent-projects');
    const { projects } = (await res.json()) as { projects: Array<{ path: string; branch: string | null }> };
    const entry = projects.find((p) => p.path === wt);
    expect(entry, 'the scanned worktree is a recent project').toBeTruthy();
    expect(entry!.branch).toBe(BRANCH);
  });

  test('git/info sees the commits, every local branch and the other checkout', async () => {
    const res = await h.client.raw('GET', `/api/git/info?path=${q}`);
    const info = (await res.json()) as {
      currentBranch: string | null;
      branches: string[];
      worktrees: Array<{ path: string; branch: string | null }>;
      hasCommits: boolean;
    };
    expect(info.currentBranch).toBe(BRANCH);
    expect(info.hasCommits).toBe(true);
    expect(info.branches).toEqual(expect.arrayContaining(['main', BRANCH]));
    // The OTHER checkouts: from here, that is the main one.
    expect(info.worktrees.map((w) => w.branch)).toContain('main');
    expect(info.worktrees.map((w) => fs.realpathSync(w.path))).toContain(fs.realpathSync(main));
  });

  test('git/info lists packed branches too', async () => {
    // A clone, or any repo after `git gc`, keeps branches in packed-refs
    // rather than one file per branch under refs/heads.
    git(main, 'branch', 'packed/one');
    git(main, 'pack-refs', '--all');
    const res = await h.client.raw('GET', `/api/git/info?path=${q}`);
    const info = (await res.json()) as { branches: string[] };
    expect(info.branches).toContain('packed/one');
  });

  test('commit_manifest_changes commits from the worktree', async () => {
    await h.client.grantMcpCapabilities(['read', 'write', 'project']);
    const agent = await h.spawnAgent({ agentType: 'wt-agent' });
    const rel = '.codetrellis/notes.md';
    fs.mkdirSync(path.join(wt, '.codetrellis'), { recursive: true });
    fs.writeFileSync(path.join(wt, rel), 'from the worktree\n');

    const res = await agent.callTool('commit_manifest_changes', {
      project_root: wt,
      subject: 'note from the worktree',
      paths: [rel],
    });
    expect(res.isError, res.text).not.toBe(true);
    const { sha } = JSON.parse(res.text) as { sha: string };
    expect(git(wt, 'rev-parse', 'HEAD').trim()).toBe(sha);
    expect(git(wt, 'log', '-1', '--format=%s').trim()).toBe('[cdev] note from the worktree');
    // Nothing was left behind in the checkout.
    expect(git(wt, 'status', '--porcelain').trim()).toBe('');
  });

  test('a merge conflict in .codetrellis is detected from the worktree', async () => {
    const rel = '.codetrellis/notes.md';
    // Diverge: main and the worktree branch each change the same line.
    git(main, 'checkout', '-q', '-b', 'side', 'main');
    fs.mkdirSync(path.join(main, '.codetrellis'), { recursive: true });
    fs.writeFileSync(path.join(main, rel), 'from side\n');
    git(main, 'add', rel);
    git(main, 'commit', '-q', '-m', 'side note');
    try { git(wt, 'merge', '--no-edit', 'side'); } catch { /* conflict expected */ }

    const res = await h.client.raw('GET', `/api/conflicts?project=${q}`);
    expect(res.ok).toBe(true);
    const summary = (await res.json()) as { hasConflicts: boolean; files: Array<{ filePath: string }> };
    expect(summary.hasConflicts).toBe(true);
    expect(summary.files.map((f) => f.filePath)).toContain(rel);
  });
});
