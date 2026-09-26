/**
 * git-checkout answers the same from a main checkout and a linked
 * worktree, where `.git` is a file. Real git, throwaway repo.
 */

import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

import { checkoutGitDir, currentBranch, hasCommits, localBranches } from './git-checkout';

let tmp: string;
let main: string;
let linked: string;
let fresh: string;
let plain: string;

function git(cwd: string, ...args: string[]) {
  execFileSync('git', ['-c', 'user.email=t@t', '-c', 'user.name=t', ...args], { cwd, stdio: ['ignore', 'pipe', 'ignore'] });
}

before(() => {
  tmp = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'ct-checkout-')));
  main = path.join(tmp, 'repo');
  linked = path.join(tmp, 'repo-feature');
  fresh = path.join(tmp, 'fresh');
  plain = path.join(tmp, 'plain');
  fs.mkdirSync(main);
  fs.mkdirSync(fresh);
  fs.mkdirSync(plain);
  git(main, 'init', '-q', '-b', 'main');
  git(main, 'commit', '-q', '--allow-empty', '-m', 'init');
  git(main, 'branch', 'packed/one');
  git(main, 'pack-refs', '--all');
  git(main, 'worktree', 'add', '-q', '-b', 'feature/x', linked);
  git(fresh, 'init', '-q', '-b', 'trunk');
});

after(() => {
  fs.rmSync(tmp, { recursive: true, force: true });
});

describe('currentBranch', () => {
  test('main checkout', () => assert.equal(currentBranch(main), 'main'));
  test('linked worktree, whose .git is a file', () => {
    assert.ok(fs.statSync(path.join(linked, '.git')).isFile());
    assert.equal(currentBranch(linked), 'feature/x');
  });
  test('a repo with no commits still has its branch name', () => assert.equal(currentBranch(fresh), 'trunk'));
  test('detached HEAD', () => {
    const detached = path.join(tmp, 'detached');
    git(main, 'worktree', 'add', '-q', '--detach', detached);
    assert.equal(currentBranch(detached), 'detached');
  });
  test('not a repository', () => assert.equal(currentBranch(plain), null));
  test('a path that does not exist', () => assert.equal(currentBranch(path.join(tmp, 'nope')), null));
  test('a subdirectory of a repository is not itself a checkout (unchanged behaviour)', () => {
    const sub = path.join(main, 'sub');
    fs.mkdirSync(sub, { recursive: true });
    assert.equal(currentBranch(sub), null);
  });
  test('a HEAD that climbs out with `..` is not followed', () => {
    const bogus = path.join(tmp, 'bogus');
    fs.mkdirSync(path.join(bogus, '.git'), { recursive: true });
    fs.writeFileSync(path.join(bogus, '.git', 'HEAD'), 'ref: refs/../../../etc/passwd\n');
    assert.equal(currentBranch(bogus), null);
    assert.equal(hasCommits(bogus), false);
  });
});

describe('checkoutGitDir', () => {
  test('main checkout: <root>/.git', () => assert.equal(checkoutGitDir(main), path.join(main, '.git')));
  test('linked worktree: its own dir under the common worktrees/', () => {
    const dir = checkoutGitDir(linked)!;
    assert.equal(path.dirname(dir), path.join(main, '.git', 'worktrees'));
    assert.ok(fs.existsSync(path.join(dir, 'HEAD')));
  });
  test('not a repository', () => assert.equal(checkoutGitDir(plain), null));
});

describe('localBranches', () => {
  test('includes packed branches, from either checkout', () => {
    for (const root of [main, linked]) {
      assert.deepEqual(localBranches(root).sort(), ['feature/x', 'main', 'packed/one']);
    }
  });
  test('empty for a non-repo', () => assert.deepEqual(localBranches(plain), []));
  test('a branch both packed and loose (committed to after packing) is listed once', () => {
    git(main, 'commit', '-q', '--allow-empty', '-m', 'after packing');
    assert.ok(fs.existsSync(path.join(main, '.git', 'refs', 'heads', 'main')));
    assert.ok(fs.readFileSync(path.join(main, '.git', 'packed-refs'), 'utf-8').includes('refs/heads/main'));
    assert.equal(localBranches(main).filter((b) => b === 'main').length, 1);
  });
});

describe('hasCommits', () => {
  test('true from either checkout', () => {
    assert.equal(hasCommits(main), true);
    assert.equal(hasCommits(linked), true);
  });
  test('false for a repo with no commits, and for a non-repo', () => {
    assert.equal(hasCommits(fresh), false);
    assert.equal(hasCommits(plain), false);
  });
});
