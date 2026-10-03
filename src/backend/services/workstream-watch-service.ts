/**
 * What each workstream has changed, kept current (Phase 32 A1.4).
 *
 * A workstream's changed files are what differs from where it branched off
 * the main checkout: commits since the merge base, plus uncommitted and
 * untracked work in its folder. That is the first part of its footprint
 * (awareness spec §4.2), and what collision signals will compare (A1.6).
 *
 * **The graph is not rebuilt per workstream.** Nothing here indexes or
 * parses; it asks git which paths differ. Each active folder gets one light
 * watcher that only notices that something changed, and a debounced
 * recompute follows (spec §5.3). Parsing the changed files for symbols is
 * A1.5.
 *
 * Folders come from `git worktree list`, never from a caller, and git runs
 * with `execFile`, `-C <folder>` and fixed arguments; the one ref passed in
 * is checked by `git-safety` first. It runs without blocking (`gitAsync`):
 * a recompute used to hold the backend's only thread for every git call it
 * made, and each request arriving meanwhile waited for it.
 */

import fs from 'node:fs';
import path from 'node:path';
import chokidar, { type FSWatcher } from 'chokidar';
import type { ChangedFile, WorkstreamChanges } from '../../shared/types';
import { isSafeGitRef } from './git-safety';
import { gitAsync, refreshIndexOccasionallyAsync } from './git-env';
import { checkoutWatchOptions } from './watch-ignore';

/** More than this is listed as truncated: a footprint is a summary, not a diff. */
export const MAX_CHANGED_FILES = 500;

/** Quiet time after the last file event before git is asked again. */
const debounceMs = (): number => Number(process.env.CODETRELLIS_WORKSTREAM_DEBOUNCE_MS) || 750;

/**
 * How long an unwatched folder's answer is reused. A watched folder's answer
 * is replaced on its own events, so it never goes stale this way.
 */
const UNWATCHED_TTL_MS = 20_000;

const git = (folder: string, args: string[]): Promise<string> => gitAsync(folder, args);

const STATUS: Record<string, ChangedFile['status']> = { A: 'added', M: 'modified', D: 'deleted', T: 'modified', R: 'renamed', C: 'added' };

/**
 * Parse `git diff --name-status -z` output. Pure.
 *
 * With `-z` every field ends in NUL and nothing is quoted, so a path with a
 * space, a tab or a non-ASCII name reads back exactly. A rename or copy
 * carries two paths.
 */
export function parseNameStatusZ(out: string): ChangedFile[] {
  const fields = out.split('\0');
  const files: ChangedFile[] = [];
  for (let i = 0; i < fields.length; ) {
    const code = fields[i++];
    if (!code) continue;
    const kind = STATUS[code[0]];
    if (code[0] === 'R' || code[0] === 'C') {
      const from = fields[i++];
      const to = fields[i++];
      if (!to) break;
      files.push(code[0] === 'R' ? { path: to, status: 'renamed', from } : { path: to, status: 'added' });
    } else {
      const p = fields[i++];
      if (!p || !kind) continue;
      files.push({ path: p, status: kind });
    }
  }
  return files;
}

/**
 * Lines added and removed per file, from `git diff --numstat -z`. Pure. A
 * binary file (`-\t-`) has no count; a rename is keyed by its new path.
 */
export function parseNumstatZ(out: string): Map<string, { added: number; removed: number }> {
  const counts = new Map<string, { added: number; removed: number }>();
  const fields = out.split('\0');
  for (let i = 0; i < fields.length; i++) {
    const m = /^(\d+|-)\t(\d+|-)\t(.*)$/s.exec(fields[i]);
    if (!m) continue;
    // A rename leaves the path empty and gives the old and new paths next.
    let p = m[3];
    if (p === '') { p = fields[i + 2] ?? ''; i += 2; }
    if (p && m[1] !== '-' && m[2] !== '-') counts.set(p, { added: Number(m[1]), removed: Number(m[2]) });
  }
  return counts;
}

/** The files with their line counts attached, where git gave one. Pure. */
export function withLineCounts(files: ChangedFile[], counts: Map<string, { added: number; removed: number }>): ChangedFile[] {
  return files.map((f) => {
    const c = counts.get(f.path);
    return c ? { ...f, added: c.added, removed: c.removed } : f;
  });
}

/**
 * Combine the tracked changes with untracked files, sorted by path, capped.
 * Pure. An untracked file is new work, so it is `added`.
 */
export function combineChanges(tracked: ChangedFile[], untracked: string[], max = MAX_CHANGED_FILES): { files: ChangedFile[]; truncated: boolean } {
  const byPath = new Map<string, ChangedFile>();
  for (const f of tracked) byPath.set(f.path, f);
  for (const p of untracked) if (p && !byPath.has(p)) byPath.set(p, { path: p, status: 'added' });
  const all = [...byPath.values()].sort((a, b) => a.path.localeCompare(b.path));
  return { files: all.slice(0, max), truncated: all.length > max };
}

/**
 * The changes in `folder` since it branched from `mainRef` (the main
 * checkout's branch or commit). Never throws: a folder git cannot read has
 * no changes to report.
 *
 * For the main checkout itself the merge base is its own HEAD, so this is
 * exactly its uncommitted work — the same rule, not a special case.
 */
export async function computeChanges(folder: string, mainRef: string | null): Promise<WorkstreamChanges> {
  // Reads below never write the index (git-env.ts); keep it fresh so they stay fast.
  await refreshIndexOccasionallyAsync(folder);
  let base: string | null = null;
  try {
    const ref = mainRef && isSafeGitRef(mainRef) ? mainRef : 'HEAD';
    base = (await git(folder, ['merge-base', 'HEAD', ref])).trim() || null;
  } catch {
    try {
      base = (await git(folder, ['rev-parse', '--verify', 'HEAD'])).trim() || null;
    } catch {
      base = null; // no commits yet: everything is untracked
    }
  }

  let tracked: ChangedFile[] = [];
  if (base) {
    try {
      tracked = parseNameStatusZ(await git(folder, ['diff', '--name-status', '-z', '-M', base, '--']));
      // How many lines each changed, for the graph's file nodes (B3.3).
      tracked = withLineCounts(tracked, parseNumstatZ(await git(folder, ['diff', '--numstat', '-z', '-M', base, '--'])));
    } catch { /* leave empty */ }
  }
  let untracked: string[] = [];
  try {
    untracked = (await git(folder, ['ls-files', '--others', '--exclude-standard', '-z'])).split('\0');
  } catch { /* leave empty */ }

  return { base, ...combineChanges(tracked, untracked), ...(await distanceFromMain(folder, mainRef)) };
}

/**
 * Files in `git status --porcelain -z` output. A rename or copy is one file
 * written as two entries (the new path, then the old one with no status), so
 * the old path is skipped rather than counted.
 */
export function countStatusEntries(out: string): number {
  const parts = out.split('\0');
  let n = 0;
  for (let i = 0; i < parts.length; i++) {
    const entry = parts[i];
    if (entry.length < 4 || entry[2] !== ' ') continue;
    n += 1;
    if (entry[0] === 'R' || entry[0] === 'C') i += 1;
  }
  return n;
}

/**
 * Phase 32 C5.3b — commits ahead of and behind main, and files not yet
 * committed, for "is this section ready to merge". Each is left out when git
 * cannot say, so unknown never reads as nothing.
 */
async function distanceFromMain(folder: string, mainRef: string | null): Promise<{ ahead?: number; behind?: number; uncommitted?: number }> {
  const out: { ahead?: number; behind?: number; uncommitted?: number } = {};
  if (mainRef && isSafeGitRef(mainRef)) {
    try {
      const [behind, ahead] = (await git(folder, ['rev-list', '--left-right', '--count', `${mainRef}...HEAD`])).trim().split(/\s+/).map(Number);
      if (Number.isFinite(ahead) && Number.isFinite(behind)) { out.ahead = ahead; out.behind = behind; }
    } catch { /* no main here, or no commits: unknown */ }
  }
  try {
    out.uncommitted = countStatusEntries(await git(folder, ['status', '--porcelain', '-z']));
  } catch { /* unknown */ }
  return out;
}

// ── Watching ──────────────────────────────────────────────────────────────

interface Entry {
  mainRef: string | null;
  changes: WorkstreamChanges;
  computedAt: number;
  watcher: FSWatcher | null;
  timer: ReturnType<typeof setTimeout> | null;
  /** A file event is waiting in the debounce (see `schedule`). */
  pendingEvent?: boolean;
  /** A recompute running now; another asked for meanwhile runs once after it. */
  running?: Promise<void> | null;
  again?: { fileEvent: boolean } | null;
  /** The first answer, while it is still being worked out. */
  first?: Promise<WorkstreamChanges> | null;
  /** An unwatched folder's answer being worked out now, for listings that can share it. */
  computing?: Promise<WorkstreamChanges> | null;
}

const entries = new Map<string, Entry>();

const canonical = (p: string): string => {
  try {
    return fs.realpathSync.native(p);
  } catch {
    return path.resolve(p);
  }
};

/**
 * The folder the app's own file watcher already covers: the opened project.
 * A second chokidar over the same tree would double the watches for nothing,
 * so that folder is nudged by `file-watcher` instead (`nudgeWorkstream`).
 * Held canonically, because git lists worktrees by their real path.
 */
let externallyWatched: string | null = null;

export function setExternallyWatchedFolder(folder: string | null): void {
  externallyWatched = folder ? canonical(folder) : null;
}

const isExternal = (folder: string) => externallyWatched !== null && canonical(folder) === externallyWatched;

/**
 * Something changed under `folder`, seen by another watcher. Schedules the
 * same debounced recompute a watcher's own event would.
 */
export function nudgeWorkstream(folder: string): void {
  const target = canonical(folder);
  for (const [f, entry] of entries) {
    if (canonical(f) === target) schedule(f, entry);
  }
}

/**
 * A debounced recompute. `event`: a file really changed, so the listener is
 * told even when the list of changed files is the same, because an edit to a
 * file already changed moves its symbols and signature, and with them
 * collisions and contracts (A2.6, bug 54). `check`: only asking git again
 * (the watcher just became ready), so it is told only when the list differs.
 */
function schedule(folder: string, entry: Entry, why: 'event' | 'check' = 'event'): void {
  if (entry.timer) clearTimeout(entry.timer);
  // A pending event is not downgraded by a check that arrives after it.
  if (why === 'event') entry.pendingEvent = true;
  entry.timer = setTimeout(() => {
    entry.timer = null;
    const event = entry.pendingEvent === true;
    entry.pendingEvent = false;
    void recompute(folder, entry, event);
  }, debounceMs());
}

/**
 * Told when a watched folder's changes move: a file in it changed, or the
 * list of changed files differs from what was last reported.
 */
let onChanged: (folder: string, changes: WorkstreamChanges) => void = () => {};

export function setWorkstreamChangesListener(listener: (folder: string, changes: WorkstreamChanges) => void): void {
  onChanged = listener;
}

const sameChanges = (a: WorkstreamChanges, b: WorkstreamChanges) =>
  a.base === b.base && a.truncated === b.truncated && a.files.length === b.files.length &&
  a.files.every((f, i) => f.path === b.files[i].path && f.status === b.files[i].status && f.from === b.files[i].from);

/**
 * Ask git again for a watched folder. One at a time per folder: one asked for
 * while another runs is folded into a single run after it, so a burst of
 * edits never queues a recompute per event. Settles when the folder's answer
 * is current as of the call.
 */
function recompute(folder: string, entry: Entry, fileEvent = false): Promise<void> {
  if (entry.running) {
    entry.again = { fileEvent: fileEvent || (entry.again?.fileEvent ?? false) };
    return entry.running;
  }
  const run = (async () => {
    try {
      let event = fileEvent;
      for (;;) {
        const next = await computeChanges(folder, entry.mainRef);
        const changed = event || !sameChanges(entry.changes, next);
        entry.changes = next;
        entry.computedAt = Date.now();
        if (changed) onChanged(folder, next);
        if (!entry.again) break;
        event = entry.again.fileEvent;
        entry.again = null;
      }
    } catch { /* computeChanges never throws; a listener that does is not ours */ } finally {
      // Cleared in the same step the loop ends, so a request arriving after
      // it starts a run of its own rather than waiting on one that is done.
      entry.running = null;
    }
  })();
  entry.running = run;
  return run;
}

/**
 * The changes in `folder`, from the watcher when it has one, otherwise
 * computed (and reused for a short while, unless `fresh`).
 */
export async function getChanges(folder: string, mainRef: string | null, opts: { fresh?: boolean } = {}): Promise<WorkstreamChanges> {
  let entry = entries.get(folder);
  // A watcher just started is still working out its first answer.
  if (entry?.first) await entry.first;
  const live = entry?.watcher || isExternal(folder);
  // `fresh` skips the reuse window for a folder nothing watches, for callers
  // that promise a current answer (awareness). A watched folder's answer is
  // already current.
  if (entry && entry.mainRef === mainRef && (live || (!opts.fresh && Date.now() - entry.computedAt < UNWATCHED_TTL_MS))) {
    return entry.changes;
  }
  if (!entry) {
    entry = { mainRef, changes: { base: null, files: [], truncated: false }, computedAt: 0, watcher: null, timer: null };
    entries.set(folder, entry);
  }
  // Two listings at once (a refresh and the window, say) share one answer
  // rather than each asking git. `fresh` promises an answer begun after it
  // asked, so it never takes one already under way.
  if (!opts.fresh && entry.computing && entry.mainRef === mainRef) return entry.computing;
  // Updated in place: a watcher's callback holds this entry.
  entry.mainRef = mainRef;
  const target = entry;
  const startedAt = Date.now();
  const computing = computeChanges(folder, mainRef);
  target.computing = computing;
  try {
    const changes = await computing;
    // A newer answer may have landed while this one was worked out (a
    // watcher that started meanwhile): it is kept, never overwritten.
    if (target.mainRef === mainRef && target.computedAt <= startedAt) {
      target.changes = changes;
      target.computedAt = Date.now();
    }
    return changes;
  } finally {
    if (target.computing === computing) target.computing = null;
  }
}

let onWatchStarted: (folder: string) => void = () => {};

/** Told when a folder's watcher is listening: a line of work newly watched. */
export function setWorkstreamWatchStartedListener(listener: (folder: string) => void): void {
  onWatchStarted = listener;
}

function watch(folder: string, entry: Entry): void {
  // The same rule as the opened project's watcher (watch-ignore.ts): this
  // one kept its own list, without ios/Pods and following links, and held a
  // descriptor on every file of a React Native checkout until git could no
  // longer start.
  const watcher = chokidar.watch(folder, {
    ...checkoutWatchOptions(folder),
    ignoreInitial: true,
    persistent: true,
  });
  watcher.on('all', () => schedule(folder, entry));
  // A change made while chokidar was still scanning raises no event, and
  // the answer computed before it started would then stand until the next
  // edit. Ask git once more when the watcher is actually listening.
  // And say a line of work is newly watched: an edit that landed before the
  // listing asked git is in its first answer, so no change would ever be
  // reported for it, and the signals must still take it in.
  watcher.on('ready', () => {
    schedule(folder, entry, 'check');
    onWatchStarted(folder);
  });
  watcher.on('error', () => { /* a folder that vanished is dropped on the next sync */ });
  entry.watcher = watcher;
}

async function unwatch(folder: string, entry: Entry): Promise<void> {
  if (entry.timer) clearTimeout(entry.timer);
  entry.timer = null;
  const w = entry.watcher;
  entry.watcher = null;
  if (w) await w.close().catch(() => {});
}

/**
 * Watch exactly `folders` among `scope` (one repository's working trees).
 * A folder in scope but not listed stops being watched, so a workstream that
 * goes idle (no agent, nothing changed) costs nothing; folders of another
 * repository are left alone.
 */
export async function syncWorkstreamWatchers(
  folders: ReadonlyArray<{ folder: string; mainRef: string | null }>,
  scope: readonly string[] = folders.map((f) => f.folder),
): Promise<void> {
  const wanted = new Map(folders.map((f) => [f.folder, f.mainRef]));
  const inScope = new Set(scope);
  for (const [folder, entry] of entries) {
    if (entry.watcher && inScope.has(folder) && !wanted.has(folder)) await unwatch(folder, entry);
  }
  for (const [folder, mainRef] of wanted) {
    const entry = entries.get(folder);
    if (!entry) {
      // In the map before git answers, so a second listing meanwhile finds
      // it rather than starting another watcher; readers wait for `first`.
      const created: Entry = { mainRef, changes: { base: null, files: [], truncated: false }, computedAt: 0, watcher: null, timer: null };
      entries.set(folder, created);
      if (!isExternal(folder)) watch(folder, created);
      const startedAt = Date.now();
      created.first = computeChanges(folder, mainRef);
      try {
        const changes = await created.first;
        if (created.computedAt <= startedAt) {
          created.changes = changes;
          created.computedAt = Date.now();
        }
      } finally {
        created.first = null;
      }
      continue;
    }
    if (entry.mainRef !== mainRef) {
      entry.mainRef = mainRef;
      void recompute(folder, entry);
    }
    if (!entry.watcher && !isExternal(folder)) watch(folder, entry);
  }
}

// ── Refs (A1.7a) ──────────────────────────────────────────────────────────

/** One refs watcher per repository, keyed by its common git dir. */
const refWatchers = new Map<string, { watcher: FSWatcher; timer: ReturnType<typeof setTimeout> | null }>();
/** Each working tree's common git dir, once asked: every listing calls `watchRefs`. */
const commonDirOf = new Map<string, string>();

let onRefsChanged: (repo: string) => void = () => {};

/** Told when a repository's branches move: a commit, a fetch, a new or deleted branch. */
export function setRefsChangedListener(listener: (repo: string) => void): void {
  onRefsChanged = listener;
}

/**
 * Watch a repository's refs, so a branch workstream's footprint follows its
 * branch (spec §5.3). Idempotent. `repo` is any working tree of it; the
 * watch is on the shared git dir, so every worktree's commits are seen.
 */
export async function watchRefs(repo: string): Promise<void> {
  let common = commonDirOf.get(repo);
  if (!common) {
    try {
      common = canonical(path.resolve(repo, (await git(repo, ['rev-parse', '--git-common-dir'])).trim()));
    } catch {
      return;
    }
    commonDirOf.set(repo, common);
  }
  if (refWatchers.has(common)) return;
  const targets = ['refs/heads', 'refs/remotes', 'packed-refs'].map((p) => path.join(common, p)).filter((p) => fs.existsSync(p));
  const watcher = chokidar.watch(targets, { ignoreInitial: true, persistent: true });
  const state = { watcher, timer: null as ReturnType<typeof setTimeout> | null };
  watcher.on('all', () => {
    if (state.timer) clearTimeout(state.timer);
    state.timer = setTimeout(() => {
      state.timer = null;
      onRefsChanged(repo);
    }, debounceMs());
  });
  watcher.on('error', () => {});
  refWatchers.set(common, state);
}

/**
 * Whether `folder` is already watched, by its own watcher or by the app's
 * file watcher (the opened project). A connecting agent's folder that is runs
 * no discovery pass: it would cost git calls on the request path for nothing.
 */
export function isWatchedFolder(folder: string): boolean {
  if (isExternal(folder)) return true;
  const target = canonical(folder);
  for (const [f, entry] of entries) {
    if (entry.watcher && canonical(f) === target) return true;
  }
  return false;
}

/** The folders being watched, for status and tests. */
export function watchedWorkstreamFolders(): string[] {
  return [...entries].filter(([, e]) => e.watcher).map(([f]) => f).sort();
}

/** Stop every watcher and forget every answer. For project close and tests. */
export async function stopWorkstreamWatchers(): Promise<void> {
  for (const [folder, entry] of entries) await unwatch(folder, entry);
  entries.clear();
  for (const { watcher, timer } of refWatchers.values()) {
    if (timer) clearTimeout(timer);
    await watcher.close().catch(() => {});
  }
  refWatchers.clear();
  commonDirOf.clear();
  externallyWatched = null;
}
