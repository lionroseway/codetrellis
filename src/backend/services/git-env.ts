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

import { execFile, execFileSync } from 'node:child_process';
import { AsyncLocalStorage } from 'node:async_hooks';

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

/** The same, without blocking the server. */
export async function refreshIndexOccasionallyAsync(folder: string, now = Date.now()): Promise<boolean> {
  if (now - (refreshedAt.get(folder) ?? -Infinity) < REFRESH_EVERY_MS) return false;
  refreshedAt.set(folder, now);
  // Exits 1 when files differ from the index; the refresh is still written.
  await gitAsync(folder, ['update-index', '-q', '--refresh'], { timeout: 30_000, env: { ...process.env, GIT_OPTIONAL_LOCKS: '1' } })
    .catch(() => { /* changed files, a busy lock, or not a checkout: nothing to do */ });
  return true;
}

// ── Git without blocking ─────────────────────────────────────────────────

/**
 * At most this many git processes run at once for `gitAsync`. Awareness used
 * to run git with `execFileSync`, one call after another on the backend's only
 * thread, and every request waited behind it. Run without waiting, a refresh,
 * a watcher's recompute and a listing could each start their own, so the
 * number running together is capped: the same git work as before, never
 * spread over more cores than this.
 */
export const GIT_CONCURRENCY = 4;
let running = 0;
/** Calls someone is waiting on: a request, a listing, a tool. */
const queued: Array<() => void> = [];
/** Calls nobody is waiting on (`inBackground`): served after `queued`, and never in the last slot. */
const behind: Array<() => void> = [];

/**
 * Work whose git calls give way to anyone waiting for an answer (Phase 33
 * follow-up). The branch warmer and the watchers' rechecks queued ahead of
 * the window's listings: on a checkout with 50 worktrees a listing's first
 * git call waited 10 s behind them. Their calls now wait while a caller's
 * do, and leave one slot free for the next caller.
 */
const background = new AsyncLocalStorage<true>();
export function inBackground<T>(fn: () => Promise<T>): Promise<T> {
  return background.run(true, fn);
}

function next(): void {
  if (running >= GIT_CONCURRENCY) return;
  const now = queued.shift() ?? (running < GIT_CONCURRENCY - 1 ? behind.shift() : undefined);
  if (now) { running += 1; now(); }
}

function release(): void {
  running -= 1;
  next();
}

async function slot(): Promise<void> {
  if (background.getStore()) {
    if (!queued.length && !behind.length && running < GIT_CONCURRENCY - 1) { running += 1; return; }
    await new Promise<void>((resolve) => behind.push(resolve));
    return;
  }
  if (!queued.length && running < GIT_CONCURRENCY) { running += 1; return; }
  await new Promise<void>((resolve) => queued.push(resolve));
}

/** How many git processes `gitAsync` has running and waiting, and how many of those waiting are background (tests). */
export function gitAsyncLoad(): { running: number; queued: number; behind: number } {
  return { running, queued: queued.length + behind.length, behind: behind.length };
}

/**
 * `git -C <cwd> <args>`, its stdout as text, without blocking the server.
 * `execFile`, no shell; stdin is closed and stderr is not returned. Rejects
 * when git exits non-zero, times out, or prints more than `maxBuffer`.
 */
export async function gitAsync(
  cwd: string,
  args: readonly string[],
  opts: { timeout?: number; maxBuffer?: number; env?: NodeJS.ProcessEnv } = {},
): Promise<string> {
  await slot();
  try {
    return await new Promise<string>((resolve, reject) => {
      execFile('git', ['-C', cwd, ...args], {
        encoding: 'utf-8',
        timeout: opts.timeout ?? 5000,
        maxBuffer: opts.maxBuffer ?? 16 * 1024 * 1024,
        ...(opts.env ? { env: opts.env } : {}),
      }, (err, out) => (err ? reject(err) : resolve(out))).stdin?.end();
    });
  } finally {
    release();
  }
}
