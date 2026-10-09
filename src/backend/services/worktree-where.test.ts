/**
 * Worktrees wherever they live, and none of them scanned as part of
 * another checkout.
 *
 * Git keeps every worktree it made in one list, whatever folder it is in:
 * Claude Code's `.claude/worktrees/<name>` inside the checkout, a folder
 * beside it, a tool's own folder under home, anywhere. The branch popover
 * showed a bare branch name for each, below every branch, and a worktree
 * inside the project was scanned again as part of the main checkout.
 */

import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

import { describeWorktrees, listWorktrees, worktreeWhere } from './worktree-service';
import { collectFilePaths, scanDirectory } from './project-scanner';
import { isLinkedWorktreeDir, withoutNestedCheckouts } from './git-checkout';

describe('worktreeWhere', () => {
  const main = '/u/me/code/app';
  const home = '/u/me';
  test('inside the checkout, beside it, under home, elsewhere', () => {
    assert.deepEqual(worktreeWhere('/u/me/code/app/.claude/worktrees/x', false, main, home), { where: 'inside', label: '.claude/worktrees/x' });
    assert.deepEqual(worktreeWhere('/u/me/code/app-feature', false, main, home), { where: 'beside', label: '../app-feature' });
    assert.deepEqual(worktreeWhere('/u/me/code/wt/app/y', false, main, home), { where: 'beside', label: '../wt/app/y' });
    assert.deepEqual(worktreeWhere('/u/me/.claude-worktrees/app/z', false, main, home), { where: 'home', label: '~/.claude-worktrees/app/z' });
    assert.deepEqual(worktreeWhere('/srv/build/app-ci', false, main, home), { where: 'elsewhere', label: '/srv/build/app-ci' });
  });
  test('the main checkout says so, wherever it is', () => {
    assert.deepEqual(worktreeWhere('/u/me/code/app', true, main, home), { where: 'main', label: '~/code/app' });
  });
  test('a folder whose name only starts like the checkout is not inside it', () => {
    assert.equal(worktreeWhere('/u/me/code/app2', false, main, home).where, 'beside');
  });
});

describe('every worktree of a repository, found from any checkout', () => {
  let tmp: string;
  let main: string;
  let home: string;
  const git = (cwd: string, ...args: string[]) => execFileSync('git', ['-c', 'user.email=t@t', '-c', 'user.name=t', ...args], { cwd, stdio: 'ignore' });

  before(() => {
    tmp = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'ct-wt-where-')));
    main = path.join(tmp, 'code', 'app');
    home = path.join(tmp, 'home');
    fs.mkdirSync(path.join(main, 'src'), { recursive: true });
    fs.writeFileSync(path.join(main, 'src', 'a.ts'), 'export const a = 1;\n');
    git(main, 'init', '-q', '-b', 'main');
    git(main, 'add', '-A');
    git(main, 'commit', '-q', '-m', 'init');
    git(main, 'worktree', 'add', '-q', '-b', 'claude/inside', path.join(main, '.claude', 'worktrees', 'inside'));
    git(main, 'worktree', 'add', '-q', '-b', 'beside', path.join(tmp, 'code', 'app-beside'));
    git(main, 'worktree', 'add', '-q', '-b', 'claude/home', path.join(home, '.claude-worktrees', 'app', 'home'));
    git(main, 'worktree', 'add', '-q', '-b', 'elsewhere', path.join(tmp, 'other', 'app-elsewhere'));
    git(main, 'worktree', 'add', '-q', '-b', 'gone', path.join(tmp, 'code', 'app-gone'));
    fs.rmSync(path.join(tmp, 'code', 'app-gone'), { recursive: true, force: true });
  });

  after(() => fs.rmSync(tmp, { recursive: true, force: true }));

  test('from the main checkout: inside, beside, home, elsewhere, then the missing one', () => {
    const got = describeWorktrees(listWorktrees(main), main, home);
    assert.deepEqual(got.map((w) => [w.branch, w.where, w.label, w.prunable]), [
      ['claude/inside', 'inside', '.claude/worktrees/inside', false],
      ['beside', 'beside', '../app-beside', false],
      ['claude/home', 'home', '~/.claude-worktrees/app/home', false],
      ['elsewhere', 'elsewhere', path.join(tmp, 'other', 'app-elsewhere').split(path.sep).join('/'), false],
      ['gone', 'beside', '../app-gone', true],
    ]);
  });

  test('from a worktree under home: the main checkout first, and the rest still placed against it', () => {
    const here = path.join(home, '.claude-worktrees', 'app', 'home');
    const got = describeWorktrees(listWorktrees(here), here, home);
    assert.equal(got[0].branch, 'main');
    assert.equal(got[0].where, 'main');
    assert.ok(!got.some((w) => w.branch === 'claude/home'), 'the current checkout is not listed');
    assert.equal(got.find((w) => w.branch === 'claude/inside')?.label, '.claude/worktrees/inside');
  });

  test('a worktree inside the checkout is not scanned as part of it', () => {
    assert.equal(isLinkedWorktreeDir(path.join(main, '.claude', 'worktrees', 'inside')), true);
    assert.equal(isLinkedWorktreeDir(main), false);
    const files = collectFilePaths(scanDirectory(main));
    assert.deepEqual(files.map((f) => path.relative(main, f)), [path.join('src', 'a.ts')]);
  });

  test('git status lists a worktree inside the project as one untracked folder; it is left out, a real new file is not', () => {
    fs.writeFileSync(path.join(main, 'new.ts'), 'export const n = 1;\n');
    try {
      const out = execFileSync('git', ['-C', main, 'status', '--porcelain=v1', '--untracked-files=all', '--', '.'], { encoding: 'utf8' });
      const untracked = out.split('\n').filter((l) => l.startsWith('?? ')).map((l) => l.slice(3));
      assert.ok(untracked.includes('.claude/worktrees/inside/'), `git's own listing: ${untracked}`);
      assert.deepEqual(withoutNestedCheckouts(main, untracked, (p) => p), ['new.ts']);
    } finally {
      fs.rmSync(path.join(main, 'new.ts'));
    }
  });

  test('a submodule is still scanned: its .git file names modules/, not worktrees/', () => {
    const sub = path.join(main, 'libs', 'sub');
    fs.mkdirSync(sub, { recursive: true });
    fs.writeFileSync(path.join(sub, '.git'), 'gitdir: ../../.git/modules/sub\n');
    fs.writeFileSync(path.join(sub, 'lib.ts'), 'export const lib = 1;\n');
    try {
      assert.equal(isLinkedWorktreeDir(sub), false);
      assert.ok(collectFilePaths(scanDirectory(main)).includes(path.join(sub, 'lib.ts')));
    } finally {
      fs.rmSync(path.join(main, 'libs'), { recursive: true, force: true });
    }
  });
});
