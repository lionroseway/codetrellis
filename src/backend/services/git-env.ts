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
 */

export function quietGitLocks(env: NodeJS.ProcessEnv = process.env): void {
  if (env.GIT_OPTIONAL_LOCKS === undefined) env.GIT_OPTIONAL_LOCKS = '0';
}

quietGitLocks();
