/**
 * Any ref on either side (Phase 32 E2): branches, remote branches as last
 * fetched, tags, another worktree's working copy and where two refs split,
 * each listed, compared and read, on real repositories; refused refs stay
 * refused.
 */

import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { diffCommand, filesBetween, findWorkstream, listRefs, mergeBase, parseMergeBase, sideLabel, treeOf, workingCopyTree } from './git-refs';
import { readFileAt, resolveComparand } from './snapshot-compare-service';
import type { Workstream } from '../../shared/types';

const DATA = fs.mkdtempSync(path.join(os.tmpdir(), 'ct-refs-data-'));
process.env.CODETRELLIS_DATA_DIR = DATA;

// The graph's side of a comparison reads the opened graph from the database.
before(async () => { await (await import('./database')).initDatabase(); });

const ENV = { ...process.env, GIT_AUTHOR_NAME: 'Sam Lee', GIT_AUTHOR_EMAIL: 'sam@acme.test', GIT_COMMITTER_NAME: 'Sam Lee', GIT_COMMITTER_EMAIL: 'sam@acme.test' };
const git = (cwd: string, ...args: string[]) => execFileSync('git', ['-C', cwd, ...args], { env: ENV, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
const write = (dir: string, rel: string, body: string) => {
  fs.mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true });
  fs.writeFileSync(path.join(dir, rel), body);
};

/**
 * main: refund.ts, then a release tag; billing-v2 branches from it and
 * changes refund.ts; main moves on with notes.md. A bare remote has both.
 */
function repo() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ct-refs-'));
  write(dir, 'src/refund.ts', 'round(x)\n');
  git(dir, 'init', '-q', '-b', 'main');
  git(dir, 'add', '-A');
  git(dir, 'commit', '-qm', 'Start');
  const start = git(dir, 'rev-parse', 'HEAD');
  git(dir, 'tag', '-a', 'v1.0', '-m', 'First release');
  git(dir, 'tag', 'light');
  git(dir, 'checkout', '-qb', 'billing-v2');
  write(dir, 'src/refund.ts', 'roundHalfEven(x)\n');
  git(dir, 'commit', '-qam', 'Round half-even');
  git(dir, 'checkout', '-q', 'main');
  write(dir, 'notes.md', 'notes\n');
  git(dir, 'add', '-A');
  git(dir, 'commit', '-qm', 'Notes');
  const remote = fs.mkdtempSync(path.join(os.tmpdir(), 'ct-refs-remote-'));
  execFileSync('git', ['init', '-q', '--bare', remote]);
  git(dir, 'remote', 'add', 'origin', remote);
  git(dir, 'push', '-q', 'origin', 'main', 'billing-v2');
  git(dir, 'fetch', '-q', 'origin');
  return { dir, start };
}

/** A worktree on a new branch, with a committed edit, an uncommitted one and a new file. */
function worktree(dir: string): Workstream {
  const wt = `${dir}-wt`;
  git(dir, 'worktree', 'add', '-q', '-b', 'refunds-agent', wt, 'main');
  write(wt, 'src/refund.ts', 'roundToCent(x)\n');
  git(wt, 'commit', '-qam', 'Round to the cent');
  write(wt, 'src/refund.ts', 'roundToCent(x, 2)\n');
  write(wt, 'src/cents.ts', 'export const cents = 100;\n');
  return {
    root: wt, branch: 'refunds-agent', head: git(wt, 'rev-parse', 'HEAD'), main: false, shape: 'worktree', idle: false,
    agents: [{ sessionId: 's1', agentType: 'codex', model: null, source: 'mcp', lastSeen: Date.now() }],
    changes: { base: git(dir, 'rev-parse', 'main'), files: [], truncated: false },
  } as Workstream;
}

test('lists this checkout, branches, remote branches as last fetched, tags and worktrees, each with git\'s word and command', () => {
  const { dir } = repo();
  const ws = worktree(dir);
  const own = { ...ws, root: dir, branch: 'main', main: true } as Workstream;
  const r = listRefs(dir, [own, ws]);
  assert.equal(r.git, true);
  assert.equal(r.branch, 'main');
  assert.deepEqual(r.groups.map((g) => [g.kind, g.title, g.git.term, g.git.command]), [
    ['checkout', 'This checkout', 'HEAD', 'git status'],
    ['branch', 'Branches', 'branch', 'git branch'],
    ['remote', 'Remote branches', 'remote-tracking', 'git branch -r'],
    ['tag', 'Tags', 'tag', 'git tag'],
    ['worktree', 'Worktrees', 'worktree', 'git worktree list'],
  ]);
  const of = (kind: string) => r.groups.find((g) => g.kind === kind)!.refs;
  assert.deepEqual(of('checkout').map((x) => x.spec), ['live', 'index', 'commit:HEAD']);
  assert.deepEqual(of('branch').map((x) => x.spec).sort(), ['commit:refs/heads/billing-v2', 'commit:refs/heads/main', 'commit:refs/heads/refunds-agent']);
  assert.equal(of('branch').find((x) => x.name === 'main')!.current, true);
  // origin/HEAD is not a branch of its own.
  assert.deepEqual(of('remote').map((x) => x.name).sort(), ['origin/billing-v2', 'origin/main']);
  assert.match(of('remote')[0].words, /^origin's (main|billing-v2), as last fetched \(just now\)$/);
  assert.equal(of('remote')[0].term, 'remote-tracking branch');
  assert.ok(r.fetchedAt !== null);
  // An annotated tag names its commit, not the tag object.
  const v1 = of('tag').find((x) => x.name === 'v1.0')!;
  assert.equal(v1.spec, 'commit:refs/tags/v1.0');
  assert.equal(v1.sha, git(dir, 'rev-parse', 'v1.0^{commit}').slice(0, 7));
  // The checkout itself is not another worktree.
  assert.deepEqual(of('worktree').map((x) => [x.spec, x.name, x.agents]), [[`workstream:${ws.root}`, 'refunds-agent', ['codex']]]);
});

test('each kind compares: branch with branch, from where they split, a tag, a remote branch, and a worktree\'s working copy', () => {
  const { dir, start } = repo();
  const ws = worktree(dir);
  const files = (before: string, after: string) => {
    const r = filesBetween(dir, before, after, [ws]);
    assert.ok(r.ok, `${before} → ${after}`);
    return r.files.map((f) => `${f.status} ${f.path}`).sort();
  };
  // main against billing-v2 sees main's own commit as removed: what "from where they split" is for.
  assert.deepEqual(files('commit:refs/heads/main', 'commit:refs/heads/billing-v2'), ['deleted notes.md', 'modified src/refund.ts']);
  assert.deepEqual(files('merge-base:refs/heads/main...refs/heads/billing-v2', 'commit:refs/heads/billing-v2'), ['modified src/refund.ts']);
  assert.equal(mergeBase(dir, 'refs/heads/main', 'refs/heads/billing-v2'), start);
  assert.deepEqual(files('commit:refs/tags/v1.0', 'commit:refs/heads/main'), ['added notes.md']);
  assert.deepEqual(files('commit:refs/remotes/origin/main', 'commit:refs/remotes/origin/billing-v2'), ['deleted notes.md', 'modified src/refund.ts']);
  // The worktree as it is now: its commit, its uncommitted edit and its new file.
  assert.deepEqual(files('commit:refs/heads/main', `workstream:${ws.root}`), ['added src/cents.ts', 'modified src/refund.ts']);
  // Its branch alone has only what it committed.
  assert.deepEqual(files('commit:refs/heads/main', 'commit:refs/heads/refunds-agent'), ['modified src/refund.ts']);
});

test('a working copy is read as a tree without touching the checkout, its index or its refs', () => {
  const { dir } = repo();
  write(dir, 'notes.md', 'edited\n');
  write(dir, 'new.ts', 'n\n');
  git(dir, 'add', 'new.ts');
  write(dir, 'untracked.ts', 'u\n');
  const status = git(dir, 'status', '--porcelain');
  const refs = git(dir, 'for-each-ref');
  const tree = workingCopyTree(dir);
  assert.match(tree!, /^[0-9a-f]{40}$/);
  assert.equal(git(dir, 'status', '--porcelain'), status);
  assert.equal(git(dir, 'for-each-ref'), refs);
  const r = filesBetween(dir, 'commit:HEAD', 'live', []);
  assert.ok(r.ok);
  assert.deepEqual(r.files.map((f) => `${f.status} ${f.path}`).sort(), ['added new.ts', 'added untracked.ts', 'modified notes.md']);
  const staged = filesBetween(dir, 'commit:HEAD', 'index', []);
  assert.ok(staged.ok);
  assert.deepEqual(staged.files.map((f) => `${f.status} ${f.path}`), ['added new.ts']);
});

test('each side reads plainly, and as the git command that shows the same', () => {
  const { dir } = repo();
  const ws = worktree(dir);
  assert.equal(sideLabel(dir, 'commit:refs/heads/billing-v2', [ws]), 'billing-v2');
  assert.equal(sideLabel(dir, 'commit:refs/remotes/origin/main', [ws]), 'origin/main (remote, as last fetched)');
  assert.equal(sideLabel(dir, 'commit:refs/tags/v1.0', [ws]), 'Tag v1.0');
  assert.match(sideLabel(dir, 'merge-base:refs/heads/main...refs/heads/billing-v2', [ws]), /^Where main and billing-v2 split \([0-9a-f]{7}\)$/);
  assert.equal(sideLabel(dir, `workstream:${ws.root}`, [ws]), 'refunds-agent, its working copy');
  assert.equal(diffCommand('merge-base:refs/heads/main...refs/heads/billing-v2', 'commit:refs/heads/billing-v2', [ws], 'src/refund.ts'), 'git diff main...billing-v2 -- src/refund.ts');
  assert.equal(diffCommand('commit:refs/tags/v1.0', 'commit:refs/remotes/origin/main', [ws]), 'git diff v1.0 origin/main');
  assert.equal(diffCommand('commit:refs/heads/main', 'live', [ws]), 'git diff main');
  assert.equal(diffCommand('commit:refs/heads/main', `workstream:${ws.root}`, [ws]), `git -C ${ws.root} diff main`);
  // Two working copies: no one git command, and none is made up.
  assert.equal(diffCommand(`workstream:${ws.root}`, 'live', [ws]), null);
});

test('the file at each kind: a merge base, a tag, a remote branch; the graph resolves them too', () => {
  const { dir } = repo();
  const ws = worktree(dir);
  assert.equal(readFileAt('merge-base:refs/heads/main...refs/heads/billing-v2', dir, 'src/refund.ts').content, 'round(x)\n');
  assert.match(readFileAt('merge-base:refs/heads/main...refs/heads/billing-v2', dir, 'src/refund.ts').label, /^Where main and billing-v2 split/);
  assert.equal(readFileAt('commit:refs/tags/v1.0', dir, 'notes.md').content, null);
  assert.equal(readFileAt('commit:refs/remotes/origin/billing-v2', dir, 'src/refund.ts').content, 'roundHalfEven(x)\n');
  // The graph's comparands: each resolves to its files.
  const mb = resolveComparand('merge-base:refs/heads/main...refs/heads/billing-v2', dir)!;
  assert.deepEqual([...mb.snapshot.files.keys()], ['src/refund.ts']);
  assert.equal(resolveComparand('commit:refs/remotes/origin/main', dir)!.label, 'origin/main (remote, as last fetched)');
  assert.ok(treeOf(dir, `workstream:${ws.root}`, [ws]));
});

test('refused: a ref that is an option, a range, an unknown worktree id, a folder named in place of an id', () => {
  const { dir } = repo();
  const ws = worktree(dir);
  assert.equal(parseMergeBase('merge-base:--upload-pack=x...main'), null);
  assert.equal(parseMergeBase('merge-base:main..x...main'), null);
  assert.equal(parseMergeBase('merge-base:main'), null);
  assert.equal(treeOf(dir, 'commit:--output=/tmp/x', [ws]), null);
  assert.equal(treeOf(dir, 'commit:main..billing-v2', [ws]), null);
  assert.equal(treeOf(dir, 'workstream:/etc', [ws]), null);
  assert.equal(treeOf(dir, `workstream:${dir}-elsewhere`, [ws]), null);
  const r = filesBetween(dir, 'commit:refs/heads/nope', 'live', [ws]);
  assert.equal(r.ok, false);
  assert.equal(resolveComparand('merge-base:--upload-pack=x...main', dir), null);
  assert.equal(resolveComparand('workstream:/etc', dir), null);
});

test('a project in a subfolder of its repository lists and compares only its own files', () => {
  const { dir } = repo();
  write(dir, 'packages/api/index.ts', 'a\n');
  git(dir, 'add', '-A');
  git(dir, 'commit', '-qm', 'api');
  const sub = path.join(dir, 'packages', 'api');
  write(sub, 'index.ts', 'b\n');
  write(dir, 'notes.md', 'outside\n');
  const r = filesBetween(sub, 'commit:HEAD', 'live', []);
  assert.ok(r.ok);
  assert.deepEqual(r.files.map((f) => `${f.status} ${f.path}`), ['modified index.ts']);
});

test('a file rewritten at the same size in the same clock tick as the commit is still seen as changed', () => {
  // The working copy's tree is written through a copy of the index. git
  // re-reads a file whose recorded time is not older than the index's own
  // ("racily clean"); a copy made now looked newer than every entry, so git
  // trusted the stale stat and missed the change. It failed about 3 runs in
  // 100 in CI. Here the tick is made the same on purpose: the times by hand,
  // and ctime (which only the kernel sets) by telling git not to trust it.
  const { dir } = repo();
  git(dir, 'config', 'core.trustctime', 'false');
  write(dir, 'packages/api/index.ts', 'a\n');
  const file = path.join(dir, 'packages', 'api', 'index.ts');
  // A whole second, so the time git records is exactly the one set again
  // below; in the past, so the commit does not already mark the entry racy.
  const tick = new Date(Math.floor(Date.now() / 1000) * 1000 - 10_000);
  fs.utimesSync(file, tick, tick);
  git(dir, 'add', '-A');
  git(dir, 'commit', '-qm', 'api');
  fs.writeFileSync(file, 'b\n');
  fs.utimesSync(file, tick, tick);
  fs.utimesSync(path.join(dir, '.git', 'index'), tick, tick);
  const r = filesBetween(path.join(dir, 'packages', 'api'), 'commit:HEAD', 'live', []);
  assert.ok(r.ok);
  assert.deepEqual(r.files.map((f) => `${f.status} ${f.path}`), ['modified index.ts']);
});

test('a worktree named through a link is the same worktree; a link elsewhere is not one', () => {
  // git names worktrees by their realpath. A project opened through a link
  // (macOS's /var and /tmp are links) gave ids in the opened spelling, and
  // line history answered "No such worktree" for a worktree it had listed.
  const { dir } = repo();
  const ws = worktree(dir);
  const real = { ...ws, root: fs.realpathSync.native(ws.root) };
  const link = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'ct-refs-link-')), 'wt');
  fs.symlinkSync(real.root, link, 'dir');
  assert.equal(findWorkstream([real], link)?.root, real.root);
  assert.equal(findWorkstream([real], real.root)?.root, real.root);

  const other = path.join(path.dirname(link), 'other');
  fs.symlinkSync(fs.mkdtempSync(path.join(os.tmpdir(), 'ct-refs-other-')), other, 'dir');
  assert.equal(findWorkstream([real], other), null);
  assert.equal(findWorkstream([real], '/etc'), null);
  assert.equal(findWorkstream([{ ...real, root: 'branch:billing-v2' }], 'branch:billing-v2')?.root, 'branch:billing-v2');
});
