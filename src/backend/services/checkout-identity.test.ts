/**
 * Which checkout holds a doc or plan (Phase 32 A1.7b, bug 46).
 */

import { test, describe, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { heldByAnotherCheckout, sameRepository } from './checkout-identity';

const git = (cwd: string, ...args: string[]) =>
  execFileSync('git', ['-c', 'user.email=t@t', '-c', 'user.name=t', ...args], { cwd, stdio: 'ignore' });

const tmp = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'ct-identity-')));
const main = path.join(tmp, 'app');
const wt = path.join(tmp, 'app-wt');
const clone = path.join(tmp, 'app-clone');
const copy = path.join(tmp, 'teammate'); // a folder holding a copied plan dir, no repository
const other = path.join(tmp, 'other-repo');
fs.mkdirSync(main);
git(main, 'init', '-q');
git(main, 'commit', '-q', '--allow-empty', '-m', 'init');
git(main, 'remote', 'add', 'origin', 'git@github.com:example/app.git');
git(main, 'worktree', 'add', '-q', '-b', 'draft', wt);
git(tmp, 'clone', '-q', main, clone);
git(clone, 'remote', 'set-url', 'origin', 'https://github.com/example/app.git');
fs.mkdirSync(copy);
fs.mkdirSync(other);
git(other, 'init', '-q');
git(other, 'remote', 'add', 'origin', 'https://github.com/example/other.git');
fs.symlinkSync(main, path.join(tmp, 'link-to-app'));
after(() => fs.rmSync(tmp, { recursive: true, force: true }));

describe('heldByAnotherCheckout', () => {
  test('a linked worktree of the same repository does not take the row', () => {
    assert.equal(heldByAnotherCheckout(main, wt), true);
  });

  test('a clone of the same origin does not take it either', () => {
    assert.equal(heldByAnotherCheckout(main, clone), true);
  });

  test('a folder that is not the same repository is a deliberate import, not a second checkout', () => {
    assert.equal(heldByAnotherCheckout(main, copy), false, 'a teammate export copied into a plain folder');
    assert.equal(heldByAnotherCheckout(main, other), false, 'a different repository');
  });

  test('the same checkout re-importing its own file is not "another"', () => {
    assert.equal(heldByAnotherCheckout(main, main), false);
    assert.equal(heldByAnotherCheckout(main, path.join(tmp, 'link-to-app')), false, 'compared by real path');
  });

  test('a holder whose folder is gone gives the row up to the next checkout', () => {
    assert.equal(heldByAnotherCheckout(path.join(tmp, 'moved-away'), wt), false);
  });

  test('no holder, or one that is not an absolute path, holds nothing', () => {
    assert.equal(heldByAnotherCheckout(null, wt), false);
    assert.equal(heldByAnotherCheckout(undefined, wt), false);
    assert.equal(heldByAnotherCheckout('.', wt), false);
  });
});

describe('sameRepository', () => {
  test('worktrees share a git dir; clones share an origin however it is spelled', () => {
    assert.equal(sameRepository(wt, main), true);
    assert.equal(sameRepository(clone, main), true);
    assert.equal(sameRepository(other, main), false);
    assert.equal(sameRepository(copy, main), false);
  });
});
