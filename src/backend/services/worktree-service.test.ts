/**
 * Plans on other worktrees of the same repo.
 *
 * A plan is stored against the root it was created under, so a plan made
 * in a sibling worktree was invisible from this checkout. And the only
 * worktree listing (`/api/git/info`) read `.git/worktrees` by hand, which
 * finds nothing from inside a LINKED worktree, where `.git` is a file.
 * These run real git against a throwaway repo with a real linked worktree.
 */

import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

import { listWorktrees, listWorktreesWithPlans, parseWorktreePorcelain, readWorktreePlans } from './worktree-service';

let tmp: string;
let main: string;
let linked: string;

function git(cwd: string, ...args: string[]) {
  execFileSync('git', args, { cwd, stdio: ['ignore', 'pipe', 'ignore'] });
}
function writePlan(root: string, slug: string, uid: string, title: string) {
  const dir = path.join(root, '.codetrellis', 'plans', slug);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'plan.yaml'), `uid: ${uid}\ntitle: ${title}\nstatus: active\n`);
}

before(() => {
  tmp = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'ct-wt-')));
  main = path.join(tmp, 'repo');
  linked = path.join(tmp, 'repo-feature');
  fs.mkdirSync(main);
  git(main, 'init', '-q', '-b', 'main');
  git(main, '-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '-q', '--allow-empty', '-m', 'init');
  git(main, 'worktree', 'add', '-q', '-b', 'feature/x', linked);
  writePlan(main, 'main-plan', 'uid-main', 'Plan on main');
  writePlan(linked, 'feature-plan', 'uid-feature', 'Plan on the feature worktree');
});

after(() => {
  fs.rmSync(tmp, { recursive: true, force: true });
});

describe('listing worktrees', () => {
  test('from the main checkout, both are listed with branches', () => {
    const wts = listWorktrees(main);
    assert.deepEqual(wts.map((w) => w.branch), ['main', 'feature/x']);
    assert.equal(wts[0].isMain, true);
    assert.equal(wts[0].isCurrent, true);
  });

  test('from INSIDE a linked worktree, the siblings and the main checkout are still found', () => {
    // .git is a file here; the hand-rolled reader found nothing.
    assert.ok(fs.statSync(path.join(linked, '.git')).isFile());
    const wts = listWorktrees(linked);
    assert.equal(wts.length, 2);
    assert.equal(wts.find((w) => w.isCurrent)?.branch, 'feature/x');
    assert.equal(wts.find((w) => w.isMain)?.path, main);
  });

  test('not a repository: empty, not a throw', () => {
    const plain = path.join(tmp, 'plain');
    fs.mkdirSync(plain, { recursive: true });
    assert.deepEqual(listWorktrees(plain), []);
  });
});

describe('plans per worktree', () => {
  test('each worktree reports the plans on its own disk', () => {
    const byBranch = Object.fromEntries(listWorktreesWithPlans(linked).map((w) => [w.branch, w.plans.map((p) => p.title)]));
    assert.deepEqual(byBranch['main'], ['Plan on main']);
    assert.deepEqual(byBranch['feature/x'], ['Plan on the feature worktree']);
  });

  test('a symlinked plan directory is not followed out of the worktree', () => {
    const outside = path.join(tmp, 'outside');
    writePlan(outside, 'secret', 'uid-secret', 'Outside the worktree');
    fs.symlinkSync(path.join(outside, '.codetrellis', 'plans', 'secret'), path.join(main, '.codetrellis', 'plans', 'linked-out'));
    const titles = readWorktreePlans(main).map((p) => p.title);
    assert.ok(!titles.includes('Outside the worktree'), `followed a link: ${titles}`);
  });
});

describe('porcelain parsing', () => {
  test('detached, bare and prunable entries', () => {
    const out = [
      'worktree /r', 'bare', '',
      'worktree /r/a', 'HEAD abc', 'detached', '',
      'worktree /r/b', 'HEAD def', 'branch refs/heads/feat/y', 'prunable gitdir file points to non-existent location', '',
    ].join('\n');
    const wts = parseWorktreePorcelain(out, '/nowhere');
    assert.equal(wts[0].bare, true);
    assert.equal(wts[1].branch, null);
    assert.equal(wts[2].branch, 'feat/y');
    assert.equal(wts[2].prunable, true);
  });
});
