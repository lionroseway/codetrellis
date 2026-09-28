/**
 * Branch workstreams (Phase 32 A1.7a): work that is on a branch but in no
 * working tree on this machine — pushed by a cloud agent, or left by a
 * session that finished (awareness spec §4.1, §5.1).
 *
 * A branch counts when it is:
 *  - a local branch, or a local copy of a remote one (never fetched here:
 *    the app only reads refs that are already local, so the update check
 *    stays the only request it makes on its own);
 *  - ahead of its merge base with the main checkout's branch;
 *  - not checked out in any worktree (then it is that worktree's workstream);
 *  - changed within `sensors.awareness.branchWindowDays` (default 7).
 *
 * Its changes are `git diff <merge-base> <branch>`: committed work only, as
 * there is no working tree to have uncommitted work in. Symbols come from
 * `git show <branch>:<path>`, so nothing is checked out.
 */

import { execFileSync } from 'node:child_process';
import type { ChangedFile, WorkstreamChanges } from '../../shared/types';
import { isSafeGitRef } from './git-safety';
import { parseNameStatusZ, combineChanges } from './workstream-watch-service';

export interface BranchRef {
  /** Full ref name, e.g. `refs/heads/billing-v2` or `refs/remotes/origin/billing-v2`. */
  ref: string;
  /** What a person calls it: `billing-v2`, `origin/billing-v2`. */
  short: string;
  /** Commit it points at. */
  head: string;
  /** Unix seconds of that commit. */
  committedAt: number;
}

function git(repo: string, args: string[]): string {
  return execFileSync('git', ['-C', repo, ...args], {
    encoding: 'utf-8', stdio: ['ignore', 'pipe', 'ignore'], timeout: 5000, maxBuffer: 16 * 1024 * 1024,
  });
}

/** Parse `git for-each-ref --format='%(refname)%00%(refname:short)%00%(objectname)%00%(committerdate:unix)'`. Pure. */
export function parseForEachRef(out: string): BranchRef[] {
  return out.split('\n').flatMap((line) => {
    const [ref, short, head, when] = line.split('\0');
    if (!ref || !short || !head) return [];
    return [{ ref, short, head, committedAt: Number(when) || 0 }];
  });
}

/**
 * Which refs are branch workstreams. Pure.
 *
 *  - `origin/HEAD` and other symbolic heads are not work.
 *  - A remote branch with a local branch of the same name is that local
 *    branch, not a second workstream.
 *  - Checked-out branches belong to their worktree.
 *  - Too old, or not ahead of main (`aheadOf` answers that), and it is
 *    not current work.
 */
export function selectBranchWorkstreams(
  refs: readonly BranchRef[],
  opts: { mainBranch: string | null; checkedOut: ReadonlySet<string>; windowDays: number; nowSec: number; aheadOf: (ref: BranchRef) => boolean },
): BranchRef[] {
  const local = new Set(refs.filter((r) => r.ref.startsWith('refs/heads/')).map((r) => r.short));
  const cutoff = opts.nowSec - opts.windowDays * 86_400;
  return refs.filter((r) => {
    if (r.ref.endsWith('/HEAD')) return false;
    const name = r.ref.startsWith('refs/remotes/') ? r.short.split('/').slice(1).join('/') : r.short;
    if (r.ref.startsWith('refs/remotes/') && local.has(name)) return false;
    if (name === opts.mainBranch || opts.checkedOut.has(name)) return false;
    if (r.committedAt < cutoff) return false;
    return opts.aheadOf(r);
  });
}

/** Every local and remote-tracking branch in the repository. Never throws. */
export function listBranchRefs(repo: string): BranchRef[] {
  try {
    return parseForEachRef(git(repo, [
      'for-each-ref', '--format=%(refname)%00%(refname:short)%00%(objectname)%00%(committerdate:unix)',
      'refs/heads', 'refs/remotes',
    ]));
  } catch {
    return [];
  }
}

/** Does `ref` have commits `mainRef` does not? Never throws. */
export function isAhead(repo: string, mainRef: string, head: string): boolean {
  if (!isSafeGitRef(mainRef) || !/^[0-9a-f]{40}$/.test(head)) return false;
  try {
    return Number(git(repo, ['rev-list', '--count', `${mainRef}..${head}`]).trim()) > 0;
  } catch {
    return false;
  }
}

/** A branch's committed changes since its merge base with main. Never throws. */
export function branchChanges(repo: string, mainRef: string | null, head: string): WorkstreamChanges {
  if (!mainRef || !isSafeGitRef(mainRef) || !/^[0-9a-f]{40}$/.test(head)) return { base: null, files: [], truncated: false };
  let base: string | null = null;
  try {
    base = git(repo, ['merge-base', mainRef, head]).trim() || null;
  } catch {
    return { base: null, files: [], truncated: false };
  }
  let files: ChangedFile[] = [];
  try {
    files = parseNameStatusZ(git(repo, ['diff', '--name-status', '-z', '-M', base!, head, '--']));
  } catch { /* none */ }
  return { base, ...combineChanges(files, []) };
}

/** A file's content on a commit, or null. For symbols without a checkout. */
export function showAt(repo: string, commit: string, relPath: string): string | null {
  if (!/^[0-9a-f]{40}$/.test(commit) || relPath.startsWith('-')) return null;
  try {
    return git(repo, ['show', `${commit}:${relPath}`]);
  } catch {
    return null;
  }
}

// ── With caching ─────────────────────────────────────────────────────────

export interface BranchWorkstream extends BranchRef {
  changes: WorkstreamChanges;
}

/** Answers per (branch head, main head): a branch that has not moved costs nothing to list again. */
const cache = new Map<string, { ahead: boolean; changes: WorkstreamChanges | null }>();

/**
 * The branch workstreams of a repository, each with its changes. `repo` is a
 * working tree of it (the main checkout). Never throws.
 */
export function branchWorkstreamsOf(
  repo: string,
  opts: { mainBranch: string | null; mainRef: string | null; checkedOut: ReadonlySet<string>; windowDays: number; nowSec?: number },
): BranchWorkstream[] {
  if (!opts.mainRef || !isSafeGitRef(opts.mainRef)) return [];
  let mainHead: string;
  try {
    mainHead = git(repo, ['rev-parse', '--verify', opts.mainRef]).trim();
  } catch {
    return [];
  }
  if (cache.size > 2_000) cache.clear();
  const entry = (r: BranchRef) => {
    const k = `${repo}\0${r.head}\0${mainHead}`;
    let hit = cache.get(k);
    if (!hit) {
      hit = { ahead: isAhead(repo, mainHead, r.head), changes: null };
      cache.set(k, hit);
    }
    return hit;
  };
  const selected = selectBranchWorkstreams(listBranchRefs(repo), {
    mainBranch: opts.mainBranch,
    checkedOut: opts.checkedOut,
    windowDays: opts.windowDays,
    nowSec: opts.nowSec ?? Math.floor(Date.now() / 1000),
    aheadOf: (r) => entry(r).ahead,
  });
  return selected.map((r) => {
    const hit = entry(r);
    if (!hit.changes) hit.changes = branchChanges(repo, mainHead, r.head);
    return { ...r, changes: hit.changes };
  });
}
