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
import { quietGitLocks, refreshIndexOccasionally, REFRESH_EVERY_MS } from './git-env';

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

test('the index is refreshed now and then, so lock-free reads of a fresh checkout stop re-hashing it', () => {
  const dir = repoWithStaleIndex();
  const env: NodeJS.ProcessEnv = { ...process.env, GIT_OPTIONAL_LOCKS: '0' };
  const before = indexStamp(dir);
  assert.equal(refreshIndexOccasionally(dir, 1_000_000), true);
  const refreshed = indexStamp(dir);
  assert.notEqual(refreshed, before, 'written once, by the refresh');
  // A lock-free status after it has nothing stale to re-hash or write.
  execFileSync('git', ['-C', dir, 'status', '--porcelain'], { env });
  assert.equal(indexStamp(dir), refreshed);
  // Not again within the window; again after it.
  assert.equal(refreshIndexOccasionally(dir, 1_000_000 + REFRESH_EVERY_MS - 1), false);
  assert.equal(refreshIndexOccasionally(dir, 1_000_000 + REFRESH_EVERY_MS), true);
});

test('when someone else holds the index lock, the refresh gives way and leaves their lock alone', () => {
  const dir = repoWithStaleIndex();
  const lock = path.join(dir, '.git', 'index.lock');
  fs.writeFileSync(lock, '');
  const before = indexStamp(dir);
  assert.equal(refreshIndexOccasionally(dir, 5_000_000), true);
  assert.equal(indexStamp(dir), before);
  assert.equal(fs.existsSync(lock), true);
  assert.equal(refreshIndexOccasionally('/nonexistent/folder', 5_000_000), true, 'not a checkout: no throw');
});
