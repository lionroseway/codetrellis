/**
 * Branch workstreams (Phase 32 A1.7a): which branches count, what they
 * changed, and that a moving ref is noticed. Against a real repository with
 * local branches, remote-tracking refs and a worktree.
 */

import { test, describe, before, after, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

process.env.CODETRELLIS_WORKSTREAM_DEBOUNCE_MS = '100';

import { parseForEachRef, selectBranchWorkstreams, branchWorkstreamsOf, showAt, listBranchRefs, type BranchRef } from './branch-workstreams';
import { watchRefs, setRefsChangedListener, stopWorkstreamWatchers } from './workstream-watch-service';

const BASE_ENV = { ...process.env, GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@x', GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@x' };
const git = (cwd: string, args: string[], env: Record<string, string> = {}) =>
  execFileSync('git', ['-C', cwd, ...args], { env: { ...BASE_ENV, ...env }, encoding: 'utf-8' }).trim();

let tmp: string;
let repo: string;
let tree: string;

/** Commit `files` onto `branch` without checking it out, the way a fetch or another machine would. */
function commitOnto(branch: string, files: Record<string, string>, env: Record<string, string> = {}): string {
  const parent = git(repo, ['rev-parse', branch]);
  const idx = path.join(tmp, `index-${Math.random().toString(36).slice(2)}`);
  const e = { ...env, GIT_INDEX_FILE: idx };
  git(repo, ['read-tree', parent], e);
  for (const [p, body] of Object.entries(files)) {
    const blob = execFileSync('git', ['-C', repo, 'hash-object', '-w', '--stdin'], { input: body, env: BASE_ENV, encoding: 'utf-8' }).trim();
    git(repo, ['update-index', '--add', '--cacheinfo', `100644,${blob},${p}`], e);
  }
  const treeSha = git(repo, ['write-tree'], e);
  const commit = git(repo, ['commit-tree', treeSha, '-p', parent, '-m', `on ${branch}`], e);
  git(repo, ['update-ref', `refs/heads/${branch}`, commit]);
  fs.rmSync(idx, { force: true });
  return commit;
}

before(() => {
  tmp = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'ct-branches-')));
  repo = path.join(tmp, 'app');
  tree = path.join(tmp, 'app-wt');
  fs.mkdirSync(repo);
  git(repo, ['init', '-q', '-b', 'main']);
  fs.mkdirSync(path.join(repo, 'src'));
  fs.writeFileSync(path.join(repo, 'src/session.ts'), 'export function refreshToken() { return 1 }\nexport function keep() { return 1 }\n');
  git(repo, ['add', '-A']);
  git(repo, ['commit', '-q', '-m', 'init']);

  for (const b of ['feature-a', 'merged', 'checked-out', 'old-work']) git(repo, ['branch', b]);
  commitOnto('feature-a', { 'src/session.ts': 'export function refreshToken() { return 2 }\nexport function keep() { return 1 }\n', 'src/new.ts': 'export function added() {}\n' });
  commitOnto('checked-out', { 'src/other.ts': 'export const x = 1\n' });
  const month = String(Math.floor(Date.now() / 1000) - 30 * 86_400);
  commitOnto('old-work', { 'src/old.ts': 'export const o = 1\n' }, { GIT_COMMITTER_DATE: `${month} +0000`, GIT_AUTHOR_DATE: `${month} +0000` });
  git(repo, ['worktree', 'add', '-q', tree, 'checked-out']);

  // Remote-tracking refs, as a fetch leaves them.
  git(repo, ['update-ref', 'refs/remotes/origin/main', git(repo, ['rev-parse', 'main'])]);
  git(repo, ['update-ref', 'refs/remotes/origin/feature-a', git(repo, ['rev-parse', 'feature-a'])]);
  git(repo, ['branch', 'cloud-tmp', 'main']);
  const cloud = commitOnto('cloud-tmp', { 'src/cloud.ts': 'export function fromTheCloud() {}\n' });
  git(repo, ['update-ref', 'refs/remotes/origin/cloud-agent', cloud]);
  git(repo, ['branch', '-D', 'cloud-tmp']);
  git(repo, ['symbolic-ref', 'refs/remotes/origin/HEAD', 'refs/remotes/origin/main']);
});

afterEach(async () => {
  await stopWorkstreamWatchers();
  setRefsChangedListener(() => {});
});

after(() => fs.rmSync(tmp, { recursive: true, force: true }));

const opts = (extra: Partial<Parameters<typeof branchWorkstreamsOf>[1]> = {}) =>
  ({ mainBranch: 'main', mainRef: 'main', checkedOut: new Set(['main', 'checked-out']), windowDays: 7, ...extra });

describe('which branches are workstreams', () => {
  test('recent, ahead, not checked out: a local branch and a remote one with no local copy', () => {
    assert.deepEqual(branchWorkstreamsOf(repo, opts()).map((b) => b.short).sort(), ['feature-a', 'origin/cloud-agent']);
  });

  test('not: main, a checked-out branch, one not ahead, origin/HEAD, a remote copy of a local branch, or old work', () => {
    const names = branchWorkstreamsOf(repo, opts()).map((b) => b.short);
    for (const excluded of ['main', 'checked-out', 'merged', 'origin/HEAD', 'origin/main', 'origin/feature-a', 'old-work']) {
      assert.ok(!names.includes(excluded), `${excluded} is not a branch workstream`);
    }
  });

  test('the window is a setting: widen it and old work counts', () => {
    assert.ok(branchWorkstreamsOf(repo, opts({ windowDays: 60 })).some((b) => b.short === 'old-work'));
  });

  test('a detached or unsafe main ref yields nothing rather than guessing', () => {
    assert.deepEqual(branchWorkstreamsOf(repo, opts({ mainRef: '--all' })), []);
    assert.deepEqual(branchWorkstreamsOf(repo, opts({ mainRef: null })), []);
  });
});

describe('what a branch changed', () => {
  test('committed changes since its merge base, read from git, nothing checked out', () => {
    const a = branchWorkstreamsOf(repo, opts()).find((b) => b.short === 'feature-a')!;
    assert.deepEqual(a.changes.files.map((f) => `${f.status} ${f.path}`), ['added src/new.ts', 'modified src/session.ts']);
    assert.match(a.changes.base ?? '', /^[0-9a-f]{40}$/);
    assert.match(showAt(repo, a.head, 'src/session.ts') ?? '', /return 2/);
    assert.equal(showAt(repo, a.head, '--output=x'), null);
  });
});

describe('parsing and selection', () => {
  test('for-each-ref output', () => {
    const out = [['refs/heads/x', 'x', 'a'.repeat(40), '100'], ['refs/remotes/origin/HEAD', 'origin/HEAD', 'b'.repeat(40), '100']]
      .map((f) => f.join('\x00')).join('\n') + '\n';
    assert.deepEqual(parseForEachRef(out).map((r) => [r.short, r.committedAt]), [['x', 100], ['origin/HEAD', 100]]);
  });

  test('selection is pure given its inputs', () => {
    const NOW = 10 * 86_400;
    const ref = (r: string, short: string, when = NOW): BranchRef => ({ ref: r, short, head: 'c'.repeat(40), committedAt: when });
    const picked = selectBranchWorkstreams(
      [ref('refs/heads/a', 'a'), ref('refs/remotes/origin/a', 'origin/a'), ref('refs/remotes/origin/b', 'origin/b'), ref('refs/heads/stale', 'stale', 0)],
      { mainBranch: 'main', checkedOut: new Set(), windowDays: 1, nowSec: NOW, aheadOf: () => true },
    );
    assert.deepEqual(picked.map((r) => r.short), ['a', 'origin/b']);
  });

  test('the repository lists its refs', () => {
    assert.ok(listBranchRefs(repo).some((r) => r.ref === 'refs/remotes/origin/cloud-agent'));
  });
});

describe('a moving branch is noticed', () => {
  test("a commit onto a branch nobody has checked out wakes the refs watcher", async () => {
    const heard: string[] = [];
    setRefsChangedListener((r) => heard.push(r));
    watchRefs(repo);
    watchRefs(tree); // same repository: still one watcher
    await new Promise((r) => setTimeout(r, 300));
    commitOnto('feature-a', { 'src/later.ts': 'export const l = 1\n' });
    await new Promise((r) => setTimeout(r, 700));
    assert.ok(heard.length >= 1, 'the listener was told');
  });
});
