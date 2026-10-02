/**
 * Phase 32 E2a — any ref on either side, end to end, with no plan.
 *
 * In the opened repository: a branch an agent committed on, a tag, a remote
 * branch as last fetched, another worktree with uncommitted work. Each is
 * listed by GET /api/git/refs with git's word and command, each pair compares
 * file by file through GET /api/git/refs/compare, each file reads at its side
 * through /api/file/at, and the graph's comparison (/api/compare) takes the
 * same two sides. Refs that are options, ranges or folders are refused.
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { test, expect } from '@playwright/test';
import { setupHarness, type Harness } from '../harness';

const ENV = { ...process.env, GIT_AUTHOR_NAME: 'Sam Lee', GIT_AUTHOR_EMAIL: 'sam@acme.test', GIT_COMMITTER_NAME: 'Sam Lee', GIT_COMMITTER_EMAIL: 'sam@acme.test' };

interface Ref { spec: string; kind: string; name: string; term: string; agents?: string[] }
interface Listing { git: boolean; branch: string | null; groups: Array<{ kind: string; title: string; git: { term: string; command: string }; refs: Ref[] }>; fetchedAt: number | null }
interface Pair { labels: { before: string; after: string }; files: Array<{ path: string; status: string }>; command: string | null; words: string }

test.describe.serial('Any ref on either side', () => {
  test.setTimeout(180_000);
  let h: Harness;
  let root: string;
  let file: string;
  let worktree: string;

  const git = (cwd: string, ...args: string[]) => execFileSync('git', ['-C', cwd, ...args], { env: ENV, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
  const q = () => `project=${encodeURIComponent(root)}`;
  const refs = async () => (await (await h.client.raw('GET', `/api/git/refs?${q()}`)).json()) as Listing;
  const pair = async (before: string, after: string) => {
    const res = await h.client.raw('GET', `/api/git/refs/compare?${q()}&before=${encodeURIComponent(before)}&after=${encodeURIComponent(after)}`);
    return { status: res.status, body: (await res.json()) as Pair & { error?: string } };
  };
  const at = async (spec: string, rel: string) =>
    ((await (await h.client.raw('GET', `/api/file/at?${q()}&path=${encodeURIComponent(rel)}&at=${encodeURIComponent(spec)}`)).json()) as { content: string | null; label: string });

  test.beforeAll(async () => {
    h = await setupHarness('refs');
    root = h.fixture.projectPath;
    git(root, 'config', 'user.name', 'Sam Lee');
    git(root, 'config', 'user.email', 'sam@acme.test');
    await h.client.scanProject(root);
    file = git(root, 'ls-files').split('\n').find((f) => /\.(ts|js)$/.test(f))!;
    const main = git(root, 'symbolic-ref', '--short', 'HEAD');
    git(root, 'tag', '-a', 'v1.0', '-m', 'First release');
    // An agent's branch, committed.
    git(root, 'checkout', '-qb', 'billing-v2');
    fs.appendFileSync(path.join(root, file), '\n// rounding, half-even\n');
    git(root, 'commit', '-qam', 'Round refunds half-even');
    git(root, 'checkout', '-q', main);
    // Main moves on.
    fs.writeFileSync(path.join(root, 'CHANGELOG.md'), 'changes\n');
    git(root, 'add', 'CHANGELOG.md');
    git(root, 'commit', '-qm', 'Changelog');
    // A remote, as last fetched.
    const remote = fs.mkdtempSync(path.join(os.tmpdir(), 'ct-refs-remote-'));
    execFileSync('git', ['init', '-q', '--bare', remote]);
    git(root, 'remote', 'add', 'origin', remote);
    git(root, 'push', '-q', 'origin', main, 'billing-v2');
    git(root, 'fetch', '-q', 'origin');
    // Another worktree, with work not yet committed.
    worktree = `${root}-agent`;
    git(root, 'worktree', 'add', '-q', '-b', 'refunds-agent', worktree, main);
    fs.appendFileSync(path.join(worktree, file), '\n// not committed yet\n');
    fs.writeFileSync(path.join(worktree, 'cents.ts'), 'export const cents = 100;\n');
  });

  test.afterAll(async () => {
    if (worktree) { try { git(root, 'worktree', 'remove', '--force', worktree); } catch { /* */ } }
    await h?.teardown();
  });

  test('lists every point: this checkout, branches, remote branches, tags and worktrees, each with git\'s word and command', async () => {
    const r = await refs();
    expect(r.git).toBe(true);
    expect(r.groups.map((g) => [g.title, g.git.term, g.git.command])).toEqual([
      ['This checkout', 'HEAD', 'git status'],
      ['Branches', 'branch', 'git branch'],
      ['Remote branches', 'remote-tracking', 'git branch -r'],
      ['Tags', 'tag', 'git tag'],
      ['Worktrees', 'worktree', 'git worktree list'],
    ]);
    const specs = r.groups.flatMap((g) => g.refs.map((x) => x.spec));
    expect(specs).toEqual(expect.arrayContaining([
      'live', 'index', 'commit:HEAD', 'commit:refs/heads/billing-v2', 'commit:refs/remotes/origin/billing-v2',
      'commit:refs/tags/v1.0', `workstream:${worktree}`,
    ]));
    expect(r.fetchedAt).not.toBeNull();
  });

  test('a branch against another, and from where they split', async () => {
    const main = (await refs()).branch!;
    const plain = await pair(`commit:refs/heads/${main}`, 'commit:refs/heads/billing-v2');
    expect(plain.status).toBe(200);
    // Main's own later commit reads as removed: the reason to compare from where they split.
    expect(plain.body.files.map((f) => `${f.status} ${f.path}`).sort()).toEqual([`deleted CHANGELOG.md`, `modified ${file}`]);
    const split = await pair(`merge-base:refs/heads/${main}...refs/heads/billing-v2`, 'commit:refs/heads/billing-v2');
    expect(split.body.files).toEqual([{ path: file, status: 'modified' }]);
    expect(split.body.command).toBe(`git diff ${main}...billing-v2`);
    expect(split.body.labels.before).toMatch(new RegExp(`^Where ${main} and billing-v2 split \\([0-9a-f]{7}\\)$`));
    expect(split.body.words).toMatch(/^1 file differs between where .* split \([0-9a-f]{7}\) and billing-v2\.$/);
    // The file at each side.
    const before = await at(`merge-base:refs/heads/${main}...refs/heads/billing-v2`, file);
    const after = await at('commit:refs/heads/billing-v2', file);
    expect(after.content).toContain('half-even');
    expect(before.content).not.toContain('half-even');
  });

  test('a tag, and a remote branch as last fetched', async () => {
    const main = (await refs()).branch!;
    const t = await pair('commit:refs/tags/v1.0', `commit:refs/heads/${main}`);
    expect(t.body.files).toEqual([{ path: 'CHANGELOG.md', status: 'added' }]);
    expect(t.body.labels.before).toBe('Tag v1.0');
    const r = await pair(`commit:refs/remotes/origin/${main}`, 'commit:refs/remotes/origin/billing-v2');
    expect(r.body.labels).toEqual({ before: `origin/${main} (remote, as last fetched)`, after: 'origin/billing-v2 (remote, as last fetched)' });
    expect(r.body.command).toBe(`git diff origin/${main} origin/billing-v2`);
  });

  test('another worktree as it is now: its uncommitted edit and its new file', async () => {
    const main = (await refs()).branch!;
    const w = await pair(`commit:refs/heads/${main}`, `workstream:${worktree}`);
    expect(w.body.files.map((f) => `${f.status} ${f.path}`).sort()).toEqual([`added cents.ts`, `modified ${file}`]);
    expect(w.body.labels.after).toBe('refunds-agent, its working copy');
    expect(w.body.command).toBe(`git -C ${worktree} diff ${main}`);
    expect((await at(`workstream:${worktree}`, file)).content).toContain('not committed yet');
    // The worktree's own checkout and index are untouched.
    expect(git(worktree, 'diff', '--cached', '--name-only')).toBe('');
    expect(git(worktree, 'ls-files', '--others', '--exclude-standard')).toBe('cents.ts');
  });

  test('the graph compares the same two', async () => {
    const main = (await refs()).branch!;
    const res = await h.client.raw('GET', `/api/compare?${q()}&before=${encodeURIComponent(`merge-base:refs/heads/${main}...refs/heads/billing-v2`)}&after=${encodeURIComponent('commit:refs/heads/billing-v2')}`);
    expect(res.status).toBe(200);
    const c = (await res.json()) as { before: { label: string }; after: { label: string }; diff: { modifiedFiles: string[]; addedFiles: string[]; removedFiles: string[] } };
    expect(c.before.label).toMatch(/^Where .* and billing-v2 split/);
    expect(c.after.label).toBe('billing-v2');
    expect(c.diff.modifiedFiles).toEqual([file]);
    expect(c.diff.removedFiles).toEqual([]);
    const w = await h.client.raw('GET', `/api/compare?${q()}&before=${encodeURIComponent(`commit:refs/heads/${main}`)}&after=${encodeURIComponent(`workstream:${worktree}`)}`);
    expect(w.status).toBe(200);
    const wd = (await w.json()) as { after: { label: string }; diff: { modifiedFiles: string[]; addedFiles: string[] } };
    expect(wd.after.label).toBe('refunds-agent, its working copy');
    expect(wd.diff.modifiedFiles).toEqual([file]);
    expect(wd.diff.addedFiles).toEqual(['cents.ts']);
  });

  test('refused: an option for a ref, a range, a folder for a worktree, a side missing, a project not open', async () => {
    for (const [before, after] of [
      ['commit:--output=/tmp/x', 'live'],
      ['commit:main..billing-v2', 'live'],
      ['merge-base:--upload-pack=x...main', 'live'],
      ['live', 'workstream:/etc'],
      ['commit:refs/heads/no-such-branch', 'live'],
    ]) {
      const r = await pair(before, after);
      expect(r.status, `${before} → ${after}`).toBe(400);
      expect(r.body.error).toMatch(/^Could not read/);
    }
    expect((await h.client.raw('GET', `/api/git/refs/compare?${q()}&before=live`)).status).toBe(400);
    expect((await h.client.raw('GET', '/api/git/refs')).status).toBe(400);
    expect((await h.client.raw('GET', `/api/git/refs?project=${encodeURIComponent('/not/opened')}`)).status).toBe(403);
    expect((await h.client.raw('GET', `/api/compare?${q()}&before=${encodeURIComponent('workstream:/etc')}&after=live`)).status).toBe(404);
  });
});
