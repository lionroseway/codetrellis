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
 *  - changed within `sensors.awareness.branchWindowDays` (default 7);
 *  - not already merged, by content (bug 53): a squash merge leaves the
 *    branch "ahead" forever, so ancestry cannot say it (see `isMergedInto`).
 *
 * Its changes are `git diff <merge-base> <branch>`: committed work only, as
 * there is no working tree to have uncommitted work in. Symbols come from
 * `git show <branch>:<path>`, so nothing is checked out.
 */

import { execFileSync } from 'node:child_process';
import type { WorkstreamChanges } from '../../shared/types';
import { isSafeGitRef } from './git-safety';
import { gitAsync as sharedGitAsync, inBackground } from './git-env';
import { parseNameStatusZ, parseNumstatZ, withLineCounts, combineChanges } from './workstream-watch-service';

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

/** The same, without blocking the server: for awareness's listing and the warmer below. */
const gitAsync = (repo: string, args: string[]): Promise<string> => sharedGitAsync(repo, args);

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

const ZERO = /^0{40}$/;

/**
 * Parse `git diff --raw -z --no-renames` / `git log --raw -z --no-renames
 * --format=`: each change as `path → blob it leaves`, `null` for a deletion.
 * Pure. Later entries win, so for a log (newest first) keep all of them.
 */
export function parseRawZ(out: string): Array<{ path: string; blob: string | null }> {
  const parts = out.split('\0');
  const changes: Array<{ path: string; blob: string | null }> = [];
  for (let i = 0; i < parts.length; i++) {
    const meta = parts[i].replace(/^\n+/, '');
    if (!meta.startsWith(':')) continue;
    const fields = meta.slice(1).split(' '); // srcMode dstMode srcBlob dstBlob status
    const path = parts[++i];
    if (!path || fields.length < 5) continue;
    changes.push({ path, blob: ZERO.test(fields[3]) || fields[4].startsWith('D') ? null : fields[3] });
  }
  return changes;
}

/**
 * Is a branch already merged into main, by content? Pure. True when every
 * file the branch changes is left, by some commit on main since the window
 * opened, at exactly the version the branch has (deleted where it deletes).
 * That is how a squash, rebase, merge or cherry-pick all look from main's
 * side — and it needs no ancestry, which a squash merge never gives.
 *
 * A branch that changes nothing is not "merged": it is idle, and says so.
 * A branch partly merged, or merged with a different resolution of one
 * file, is still work.
 */
export function isMergedInto(branch: ReadonlyArray<{ path: string; blob: string | null }>, mainLeft: ReadonlySet<string>): boolean {
  return branch.length > 0 && branch.every((c) => mainLeft.has(`${c.path}\0${c.blob ?? 'deleted'}`));
}

/** Every `path → blob` main's commits since `sinceSec` left. Never throws. */
export function mainVersionsSince(repo: string, mainHead: string, sinceSec: number): Set<string> {
  const out = new Set<string>();
  if (!/^[0-9a-f]{40}$/.test(mainHead)) return out;
  try {
    const log = git(repo, ['log', mainHead, `--since=@${Math.max(0, Math.floor(sinceSec))}`, '--max-count=5000',
      '--format=', '--raw', '-z', '--no-renames', '--no-abbrev']);
    for (const c of parseRawZ(log)) out.add(`${c.path}\0${c.blob ?? 'deleted'}`);
  } catch { /* none */ }
  return out;
}

/** The same, without blocking the server. */
export async function mainVersionsSinceAsync(repo: string, mainHead: string, sinceSec: number): Promise<Set<string>> {
  const out = new Set<string>();
  if (!/^[0-9a-f]{40}$/.test(mainHead)) return out;
  try {
    const log = await gitAsync(repo, ['log', mainHead, `--since=@${Math.max(0, Math.floor(sinceSec))}`, '--max-count=5000',
      '--format=', '--raw', '-z', '--no-renames', '--no-abbrev']);
    for (const c of parseRawZ(log)) out.add(`${c.path}\0${c.blob ?? 'deleted'}`);
  } catch { /* none */ }
  return out;
}

/** The versions a branch leaves its changed files at, relative to its merge base with main. Never throws. */
export function branchVersions(repo: string, mainHead: string, head: string): Array<{ path: string; blob: string | null }> {
  if (!/^[0-9a-f]{40}$/.test(mainHead) || !/^[0-9a-f]{40}$/.test(head)) return [];
  try {
    const base = git(repo, ['merge-base', mainHead, head]).trim();
    return parseRawZ(git(repo, ['diff', '--raw', '-z', '--no-renames', '--no-abbrev', base, head, '--']));
  } catch {
    return [];
  }
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

/** The same, without blocking the server. */
async function listBranchRefsAsync(repo: string): Promise<BranchRef[]> {
  try {
    return parseForEachRef(await gitAsync(repo, [
      'for-each-ref', '--format=%(refname)%00%(refname:short)%00%(objectname)%00%(committerdate:unix)',
      'refs/heads', 'refs/remotes',
    ]));
  } catch {
    return [];
  }
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

/** The same, without blocking the server. */
export async function showAtAsync(repo: string, commit: string, relPath: string): Promise<string | null> {
  if (!/^[0-9a-f]{40}$/.test(commit) || relPath.startsWith('-')) return null;
  try {
    return await gitAsync(repo, ['show', `${commit}:${relPath}`]);
  } catch {
    return null;
  }
}

// ── With caching ─────────────────────────────────────────────────────────

export interface BranchWorkstream extends BranchRef {
  changes: WorkstreamChanges;
}

/** Answers per (branch head, main head): a branch that has not moved costs nothing to list again. */
type Entry = { ahead: boolean; merged: boolean | null; changes: WorkstreamChanges | null };
const cache = new Map<string, Entry>();
/** What main left since the window opened, per (main head, window start in days). */
const mainCache = new Map<string, Set<string>>();

/**
 * How many branches one listing works out before it answers (Phase 32 HD4b).
 * Each takes about six git calls; with 133 recent remote branches the first
 * listing ran some 800 one after another, 6–12 s in which the server answered
 * nothing, the window included. Git no longer blocks the server, but a
 * listing that waited for 800 would still be a 10 s answer. Past this many,
 * the rest are worked out in the background, a few at a time, and the window
 * is told when they are ready. A repository with a handful of branches is
 * answered in full, as before.
 */
export const INLINE_BRANCHES = 8;
/**
 * And how long it waits for them (Phase 33 follow-up). A count alone let one
 * branch far from main hold every listing: counting its commits and diffing
 * it took 12 s on a checkout with 385 branches, and the window's six asks
 * each waited for it while the graph's own request queued behind them. Past
 * this, the branch still being worked out is finished by the warmer, from
 * the same work.
 */
export const INLINE_MS = 1_500;
const WARM_CONCURRENCY = 4;

let onWarmed: (repo: string) => void = () => {};
/** Told when branches left for the warmer are ready, so the window reads again. */
export function setBranchWorkstreamsWarmedListener(listener: (repo: string) => void): void {
  onWarmed = listener;
}

/** Tell the listener that more of a repository's branches are ready (the symbol warmer, Phase 33 0.1). */
export function notifyBranchesWarmed(repo: string): void {
  onWarmed(repo);
}

/** Repositories with a warmer running. */
const warming = new Map<string, Promise<void>>();

/** Settles when nothing is being worked out for `repo` (tests). */
export function branchWorkstreamsWarmed(repo: string): Promise<void> {
  return warming.get(repo) ?? Promise.resolve();
}

/** Forget every answer (tests). */
export function resetBranchWorkstreamCache(): void {
  cache.clear(); mainCache.clear();
}

/** Entries being worked out, so a listing that stopped waiting and the warmer share one computation. */
const inflight = new Map<string, Promise<Entry>>();

function entryFor(repo: string, mainHead: string, head: string, mainLeft: () => Promise<Set<string>>): Promise<Entry> {
  const k = `${repo}\0${head}\0${mainHead}`;
  const hit = cache.get(k);
  if (hit) return Promise.resolve(hit);
  let p = inflight.get(k);
  if (!p) {
    // In the background lane even when a listing asked: it waits only `INLINE_MS`,
    // and a branch still being diffed after that must not hold the slots its
    // next listing needs.
    p = inBackground(() => computeEntry(repo, mainHead, head, mainLeft))
      .then((e) => { cache.set(k, e); return e; })
      .finally(() => inflight.delete(k));
    inflight.set(k, p);
  }
  return p;
}

/** `p`, or null once `ms` have passed; the timer never keeps the process alive. */
function within<T>(p: Promise<T>, ms: number): Promise<T | null> {
  if (ms <= 0) return Promise.resolve(null);
  let timer: NodeJS.Timeout | undefined;
  const late = new Promise<null>((resolve) => { timer = setTimeout(() => resolve(null), ms); timer.unref?.(); });
  return Promise.race([p, late]).finally(() => clearTimeout(timer));
}

async function computeEntry(repo: string, mainHead: string, head: string, mainLeft: () => Promise<Set<string>>): Promise<Entry> {
  const entry: Entry = { ahead: false, merged: null, changes: null };
  try {
    entry.ahead = Number((await gitAsync(repo, ['rev-list', '--count', `${mainHead}..${head}`])).trim()) > 0;
  } catch { return entry; }
  if (!entry.ahead) return entry;
  let base = '';
  try { base = (await gitAsync(repo, ['merge-base', mainHead, head])).trim(); } catch { return entry; }
  try {
    const versions = parseRawZ(await gitAsync(repo, ['diff', '--raw', '-z', '--no-renames', '--no-abbrev', base, head, '--']));
    entry.merged = isMergedInto(versions, await mainLeft());
  } catch { entry.merged = false; }
  if (entry.merged) return entry;
  try {
    let files = parseNameStatusZ(await gitAsync(repo, ['diff', '--name-status', '-z', '-M', base, head, '--']));
    files = withLineCounts(files, parseNumstatZ(await gitAsync(repo, ['diff', '--numstat', '-z', '-M', base, head, '--'])));
    entry.changes = { base, ...combineChanges(files, []) };
  } catch {
    entry.changes = { base, ...combineChanges([], []) };
  }
  return entry;
}

function warm(repo: string, mainHead: string, heads: string[], mainLeft: () => Promise<Set<string>>): void {
  if (warming.has(repo) || heads.length === 0) return;
  const todo = [...new Set(heads)];
  const run = inBackground(async () => {
    const worker = async () => {
      for (let head = todo.shift(); head; head = todo.shift()) {
        await entryFor(repo, mainHead, head, mainLeft);
      }
    };
    await Promise.all(Array.from({ length: WARM_CONCURRENCY }, worker));
  }).finally(() => {
    warming.delete(repo);
    onWarmed(repo);
  });
  warming.set(repo, run);
}

/**
 * The branch workstreams of a repository, each with its changes. `repo` is a
 * working tree of it (the main checkout). Never throws. Branches beyond
 * `INLINE_BRANCHES`, or still being worked out after `INLINE_MS`, are left
 * out of this answer and worked out in the background; `setBranchWorkstreamsWarmedListener` hears
 * when they are ready. Git runs without blocking the server, so "inline"
 * means only that this answer waits for them.
 */
export async function branchWorkstreamsOf(
  repo: string,
  opts: { mainBranch: string | null; mainRef: string | null; checkedOut: ReadonlySet<string>; windowDays: number; nowSec?: number; inline?: number; inlineMs?: number },
): Promise<BranchWorkstream[]> {
  if (!opts.mainRef || !isSafeGitRef(opts.mainRef)) return [];
  let mainHead: string;
  try {
    mainHead = (await gitAsync(repo, ['rev-parse', '--verify', opts.mainRef])).trim();
  } catch {
    return [];
  }
  if (cache.size > 2_000 && !warming.size) cache.clear();
  if (mainCache.size > 50) mainCache.clear();
  const nowSec = opts.nowSec ?? Math.floor(Date.now() / 1000);
  // A squash merge lands after the branch's last commit, and the branch was
  // committed inside the window, so main's commits since the window opened
  // hold every merge that matters. A day's slack for clock skew.
  const since = nowSec - (opts.windowDays + 1) * 86_400;
  const mainKey = `${repo}\0${mainHead}\0${Math.floor(since / 86_400)}`;
  const mainLeft = async () => {
    let v = mainCache.get(mainKey);
    if (!v) { v = await mainVersionsSinceAsync(repo, mainHead, since); mainCache.set(mainKey, v); }
    return v;
  };
  // Every rule but "ahead of main and not merged into it", which needs git
  // per branch: `selectBranchWorkstreams` asks that last, so the candidates
  // it keeps here are exactly the ones that question decides.
  const candidates = selectBranchWorkstreams(await listBranchRefsAsync(repo), {
    mainBranch: opts.mainBranch,
    checkedOut: opts.checkedOut,
    windowDays: opts.windowDays,
    nowSec,
    aheadOf: () => true,
  });
  let budget = opts.inline ?? INLINE_BRANCHES;
  const deadline = Date.now() + (opts.inlineMs ?? INLINE_MS);
  const later: string[] = [];
  const selected: BranchWorkstream[] = [];
  for (const r of candidates) {
    const k = `${repo}\0${r.head}\0${mainHead}`;
    let hit = cache.get(k);
    if (!hit) {
      if (budget <= 0 || warming.has(repo)) { later.push(r.head); continue; }
      budget--;
      hit = (await within(entryFor(repo, mainHead, r.head, mainLeft), deadline - Date.now())) ?? undefined;
      // Out of time: this one and the rest are the warmer's.
      if (!hit) { budget = 0; later.push(r.head); continue; }
    }
    // Ahead by ancestry, but maybe merged by content (bug 53).
    if (!hit.ahead || hit.merged) continue;
    selected.push({ ...r, changes: hit.changes ?? { base: null, files: [], truncated: false } });
  }
  warm(repo, mainHead, later, mainLeft);
  return selected;
}
