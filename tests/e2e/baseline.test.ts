/**
 * What the baseline is, and what it says it is (Phase 32 §0.4h).
 *
 * The baseline is the reference the graph's diff compares against. Found
 * in 0.4b, fixed here (bug 29):
 *  - every scan re-pinned it to the working tree, so a rescan emptied the
 *    diff, and it was labelled with the HEAD hash even when the tree had
 *    uncommitted work in it;
 *  - "Pin current HEAD" pinned the working tree, not HEAD;
 *  - `set_baseline` changed only the window's label: the diff kept
 *    comparing against the old snapshot while saying the new commit.
 * And a commit to capture was passed to git unchecked.
 */

import { test, expect } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { setupHarness, openEventStream, type Harness, type ScriptedAgent, type EventStream } from '../harness';

interface Baseline { commitHash: string | null; shortCommitHash: string | null; source: string; dirty: boolean; capturedAt: number; label: string }

test.describe.serial('Baseline', () => {
  test.setTimeout(120_000);

  let h: Harness;
  let agent: ScriptedAgent;
  let events: EventStream;
  let root: string;
  let head: string;
  let first: string;

  const git = (...args: string[]) => execFileSync('git', args, {
    cwd: root, encoding: 'utf-8',
    env: { ...process.env, GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@x', GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@x' },
  }).trim();
  const baseline = async () => (await (await h.client.raw('GET', '/api/baseline')).json()) as Baseline;
  const diff = async () => (await (await h.client.raw('GET', `/api/diff?project=${encodeURIComponent(root)}`)).json()) as { modifiedFiles: string[]; addedFiles: string[] };
  const file = 'packages/web/src/api.ts';

  test.beforeAll(async () => {
    h = await setupHarness('baseline');
    root = h.fixture.projectPath;
    first = git('rev-parse', 'HEAD');
    // A second commit, so there is history to pin to.
    fs.appendFileSync(path.join(root, file), '\nexport const second = 2;\n');
    git('commit', '-qam', 'second');
    head = git('rev-parse', 'HEAD');
    await h.client.scanProject(root);
    agent = await h.spawnAgent({ agentType: 'claude-desktop' });
    events = await openEventStream(h.backend);
  });

  test.afterAll(async () => {
    await events?.close();
    await h?.teardown();
  });

  test('the scan baseline of a clean tree is HEAD, and says where it came from', async () => {
    const b = await baseline();
    expect(b).toMatchObject({ commitHash: head, source: 'scan', dirty: false, label: head.slice(0, 7) });
    expect(b.capturedAt).toBeGreaterThan(0);
  });

  test('a rescan keeps the baseline, so the diff still shows what changed since it', async () => {
    const before = await baseline();
    fs.appendFileSync(path.join(root, file), '\nexport const third = 3;\n');
    await expect.poll(async () => (await diff()).modifiedFiles, { timeout: 10_000 }).toContain(file);

    await h.client.scanProject(root);
    expect((await baseline()).capturedAt).toBe(before.capturedAt);
    expect((await diff()).modifiedFiles).toContain(file);
  });

  test('"Pin current HEAD" pins HEAD itself: uncommitted work shows as changes against it', async () => {
    const res = await h.client.raw('POST', '/api/baseline/capture', { projectPath: root });
    expect(res.ok).toBe(true);
    const b = await baseline();
    expect(b).toMatchObject({ commitHash: head, source: 'commit', dirty: false, label: head.slice(0, 7) });
    expect((await diff()).modifiedFiles).toContain(file);
  });

  test('a scan of a tree with uncommitted work is labelled so, never just as HEAD', async () => {
    // Opening a different project sets a new baseline; this one is dirty.
    const other = path.join(h.fixture.tmpDir, 'dirty-project');
    fs.mkdirSync(path.join(other, 'src'), { recursive: true });
    fs.writeFileSync(path.join(other, 'src', 'a.ts'), 'export const a = 1;\n');
    const g = (...args: string[]) => execFileSync('git', args, {
      cwd: other, encoding: 'utf-8',
      env: { ...process.env, GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@x', GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@x' },
    }).trim();
    g('init', '-q', '-b', 'main'); g('add', '-A'); g('commit', '-qm', 'one');
    fs.writeFileSync(path.join(other, 'src', 'a.ts'), 'export const a = 2;\n');
    const otherHead = g('rev-parse', 'HEAD');
    try {
      await h.client.scanProject(other);
      const b = await baseline();
      expect(b).toMatchObject({ commitHash: otherHead, source: 'scan', dirty: true, label: `${otherHead.slice(0, 7)} + uncommitted changes` });
    } finally {
      await h.client.scanProject(root);
    }
    // Back on the first project: a new baseline for it.
    expect((await baseline()).commitHash).toBe(head);
  });

  test('set_baseline really moves the baseline to that commit, and the window is told', async () => {
    const res = await agent.callTool('set_baseline', { commit_hash: first.slice(0, 7) });
    expect(res.isError, res.text).not.toBe(true);
    const b = await baseline();
    expect(b).toMatchObject({ commitHash: first, source: 'commit', label: first.slice(0, 7) });
    await events.waitFor('ui-set-baseline', (p) => p.commitHash === first);
    // The second commit's change (and the uncommitted one) now show against it.
    expect((await diff()).modifiedFiles).toContain(file);

    const cleared = await agent.callTool('set_baseline', { commit_hash: null });
    expect(cleared.isError, cleared.text).not.toBe(true);
    expect((await h.client.raw('GET', '/api/baseline')).status).toBe(404);
    // The next scan sets one again.
    await h.client.scanProject(root);
    expect((await baseline()).source).toBe('scan');
  });

  test('a commit that is not one, or that git would read as an option, is refused before git sees it', async () => {
    const marker = path.join(h.fixture.tmpDir, 'written-by-git.txt');
    for (const commitHash of [`--output=${marker}`, 'no-such-commit', 'HEAD~1..HEAD']) {
      const res = await h.client.raw('POST', '/api/baseline/capture', { projectPath: root, commitHash });
      expect(res.status, commitHash).toBe(400);
      const viaAgent = await agent.callTool('set_baseline', { commit_hash: commitHash });
      expect(viaAgent.isError, commitHash).toBe(true);
    }
    expect(fs.existsSync(marker)).toBe(false);
    // The baseline did not move.
    expect((await baseline()).source).toBe('scan');
  });
});
