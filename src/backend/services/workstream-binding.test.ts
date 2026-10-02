/**
 * A reported folder chooses among trusted roots, and nothing else
 * (Phase 32 A1.1).
 *
 * The folder comes from the agent — a claim, not a fact — so these tests are
 * mostly about what it must NOT be able to do: bind to a folder outside every
 * trusted root, escape one by `..` or a symlink, or have its own spelling
 * stored in place of the root the user opened.
 */

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { matchWorkstreamRoot, firstWorkstreamRoot } from './workstream-binding';

let tmp: string;
let project: string;
let worktree: string;
let outside: string;

before(() => {
  tmp = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'ct-bind-')));
  project = path.join(tmp, 'app');
  worktree = path.join(tmp, 'app-auth');
  outside = path.join(tmp, 'elsewhere');
  for (const d of [path.join(project, 'packages', 'web'), worktree, outside]) fs.mkdirSync(d, { recursive: true });
  fs.symlinkSync(outside, path.join(project, 'looks-inside'));
});

after(() => fs.rmSync(tmp, { recursive: true, force: true }));

test('the root itself, or any folder below it, binds to that root', () => {
  assert.equal(matchWorkstreamRoot(project, [project, worktree]), project);
  assert.equal(matchWorkstreamRoot(path.join(project, 'packages', 'web'), [project, worktree]), project);
  assert.equal(matchWorkstreamRoot(worktree, [project, worktree]), worktree);
});

test('a folder outside every trusted root stays unbound', () => {
  assert.equal(matchWorkstreamRoot(outside, [project, worktree]), null);
  assert.equal(matchWorkstreamRoot(tmp, [project, worktree]), null, 'the parent of a root is not inside it');
  // A sibling whose name starts like the root is not inside it.
  fs.mkdirSync(path.join(tmp, 'app-other'), { recursive: true });
  assert.equal(matchWorkstreamRoot(path.join(tmp, 'app-other'), [project]), null);
});

test('.. and a symlink are judged by where they really lead', () => {
  assert.equal(matchWorkstreamRoot(path.join(project, 'packages', '..', '..', 'elsewhere'), [project]), null);
  assert.equal(matchWorkstreamRoot(path.join(project, 'looks-inside'), [project]), null, 'a link out of the project');
});

test('relative, missing, empty or poisoned paths bind to nothing', () => {
  for (const bad of ['app', './app', '', path.join(project, 'nope'), `${project}\0/x`, null, undefined]) {
    assert.equal(matchWorkstreamRoot(bad as string, [project]), null, String(bad));
  }
});

test('the root is returned as the user opened it, not as the agent spelled it', () => {
  const opened = path.join(tmp, 'via-link');
  fs.symlinkSync(project, opened);
  assert.equal(matchWorkstreamRoot(path.join(project, 'packages'), [opened]), opened);
});

test('when roots nest, the deepest wins; of several reported folders, the first that binds', () => {
  const nested = path.join(project, 'packages');
  assert.equal(matchWorkstreamRoot(path.join(nested, 'web'), [project, nested]), nested);
  assert.equal(firstWorkstreamRoot([outside, worktree, project], [project, worktree]), worktree);
  assert.equal(firstWorkstreamRoot([outside], [project]), null);
});
