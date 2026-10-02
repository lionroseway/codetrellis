/**
 * Git run by CodeTrellis reads without rewriting the person's index, so it
 * never holds `.git/index.lock` against their own `git add` (A7.3 found it:
 * the M7 harness's checkout met the watcher's `git status`).
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { quietGitLocks } from './git-env';

function repoWithStaleIndex(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ct-git-env-'));
  const git = (...a: string[]) => execFileSync('git', ['-C', dir, ...a], { env: { ...process.env, GIT_OPTIONAL_LOCKS: '1' } });
  git('init', '-q');
  for (let i = 0; i < 20; i++) fs.writeFileSync(path.join(dir, `f${i}.txt`), String(i));
  git('add', '-A');
  git('-c', 'user.email=t@x', '-c', 'user.name=t', 'commit', '-qm', 'init');
  // Same content, new times: a status refreshes these entries.
  const later = new Date(Date.now() + 60_000);
  for (let i = 0; i < 20; i++) fs.utimesSync(path.join(dir, `f${i}.txt`), later, later);
  return dir;
}

const indexStamp = (dir: string) => {
  const s = fs.statSync(path.join(dir, '.git', 'index'));
  return `${s.ino}:${s.mtimeMs}:${s.size}`;
};

test('the backend sets the switch, and keeps one the person set', () => {
  const env: NodeJS.ProcessEnv = {};
  quietGitLocks(env);
  assert.equal(env.GIT_OPTIONAL_LOCKS, '0');
  const theirs: NodeJS.ProcessEnv = { GIT_OPTIONAL_LOCKS: '1' };
  quietGitLocks(theirs);
  assert.equal(theirs.GIT_OPTIONAL_LOCKS, '1');
  assert.equal(process.env.GIT_OPTIONAL_LOCKS ?? '0', '0', 'importing it sets it for this process');
});

test('with it, `git status` reads without rewriting the index; without it, the same status rewrites it', () => {
  const quiet = repoWithStaleIndex();
  const before = indexStamp(quiet);
  const env: NodeJS.ProcessEnv = { ...process.env };
  delete env.GIT_OPTIONAL_LOCKS;
  quietGitLocks(env);
  execFileSync('git', ['-C', quiet, 'status', '--porcelain'], { env });
  assert.equal(indexStamp(quiet), before, 'no write, so no index.lock held');

  const loud = repoWithStaleIndex();
  const was = indexStamp(loud);
  execFileSync('git', ['-C', loud, 'status', '--porcelain'], { env: { ...process.env, GIT_OPTIONAL_LOCKS: '1' } });
  assert.notEqual(indexStamp(loud), was, 'the control: an ordinary status writes the index back');
});
