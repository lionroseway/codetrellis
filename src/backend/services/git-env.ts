/**
 * Git run by CodeTrellis never takes a lock it does not need.
 *
 * `git status` (and `git diff` against the working tree) refresh the index
 * as they read and write it back, holding `.git/index.lock` while they do.
 * The workstream watcher runs them often, in the person's own checkout, so
 * the person's `git add` or `git commit` failed with "index.lock: File
 * exists" whenever the two met: 51 of 150 in a loop beside a watcher, none
 * with the lock off. `GIT_OPTIONAL_LOCKS=0` is git's own switch for
 * background readers (git-status(1), "Background refresh"). Set once, for
 * the backend process, so every git it starts inherits it; a value the
 * person set is kept.
 *
 * The cost: a reader that never writes the index never refreshes it, and a
 * fresh checkout's index is racily clean (every file as new as the index),
 * so each status re-hashed the whole tree: 165 ms instead of 9 on this
 * repository, 1.9 s on a larger working tree, for as long as nothing else
 * wrote the index. `refreshIndexOccasionally` writes it, briefly and at most
 * once per folder every ten minutes, and gives way when someone else holds
 * the lock.
 */

import { execFileSync } from 'node:child_process';

export function quietGitLocks(env: NodeJS.ProcessEnv = process.env): void {
  if (env.GIT_OPTIONAL_LOCKS === undefined) env.GIT_OPTIONAL_LOCKS = '0';
}

quietGitLocks();

export const REFRESH_EVERY_MS = 10 * 60 * 1000;
const refreshedAt = new Map<string, number>();

/**
 * Refresh `folder`'s index, if not done in the last `REFRESH_EVERY_MS`, so
 * lock-free reads stay fast. Never throws: a folder that is not a checkout,
 * or whose index someone else is writing, is left as it is (and tried again
 * next time). Returns whether it ran.
 */
export function refreshIndexOccasionally(folder: string, now = Date.now()): boolean {
  if (now - (refreshedAt.get(folder) ?? -Infinity) < REFRESH_EVERY_MS) return false;
  refreshedAt.set(folder, now);
  try {
    // Exits 1 when files differ from the index; the refresh is still written.
    execFileSync('git', ['-C', folder, 'update-index', '-q', '--refresh'], {
      stdio: 'ignore', timeout: 30_000, env: { ...process.env, GIT_OPTIONAL_LOCKS: '1' },
    });
  } catch { /* changed files, a busy lock, or not a checkout: nothing to do */ }
  return true;
}
