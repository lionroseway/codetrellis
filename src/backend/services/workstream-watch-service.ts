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
 * is checked by `git-safety` first.
 */

import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import chokidar, { type FSWatcher } from 'chokidar';
import type { ChangedFile, WorkstreamChanges } from '../../shared/types';
import { isSafeGitRef } from './git-safety';

/** More than this is listed as truncated: a footprint is a summary, not a diff. */
export const MAX_CHANGED_FILES = 500;

/** Quiet time after the last file event before git is asked again. */
const debounceMs = (): number => Number(process.env.CODETRELLIS_WORKSTREAM_DEBOUNCE_MS) || 750;

/**
 * How long an unwatched folder's answer is reused. A watched folder's answer
 * is replaced on its own events, so it never goes stale this way.
 */
const UNWATCHED_TTL_MS = 20_000;

/** Paths a watcher ignores: dependencies, build output, git's own files. */
const IGNORED = /(^|[/\\])(node_modules|\.git|dist|build|out|coverage|\.next|\.turbo|\.codetrellis)([/\\]|$)/;

function git(folder: string, args: string[]): string {
  return execFileSync('git', ['-C', folder, ...args], {
    encoding: 'utf-8',
    stdio: ['ignore', 'pipe', 'ignore'],
    timeout: 5000,
    maxBuffer: 16 * 1024 * 1024,
  });
}

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
export function computeChanges(folder: string, mainRef: string | null): WorkstreamChanges {
  let base: string | null = null;
  try {
    const ref = mainRef && isSafeGitRef(mainRef) ? mainRef : 'HEAD';
    base = git(folder, ['merge-base', 'HEAD', ref]).trim() || null;
  } catch {
    try {
      base = git(folder, ['rev-parse', '--verify', 'HEAD']).trim() || null;
    } catch {
      base = null; // no commits yet: everything is untracked
    }
  }

  let tracked: ChangedFile[] = [];
  if (base) {
    try {
      tracked = parseNameStatusZ(git(folder, ['diff', '--name-status', '-z', '-M', base, '--']));
    } catch { /* leave empty */ }
  }
  let untracked: string[] = [];
  try {
    untracked = git(folder, ['ls-files', '--others', '--exclude-standard', '-z']).split('\0');
  } catch { /* leave empty */ }

  return { base, ...combineChanges(tracked, untracked) };
}

// ── Watching ──────────────────────────────────────────────────────────────

interface Entry {
  mainRef: string | null;
  changes: WorkstreamChanges;
  computedAt: number;
  watcher: FSWatcher | null;
  timer: ReturnType<typeof setTimeout> | null;
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

function schedule(folder: string, entry: Entry): void {
  if (entry.timer) clearTimeout(entry.timer);
  entry.timer = setTimeout(() => {
    entry.timer = null;
    recompute(folder, entry);
  }, debounceMs());
}

/** Told when a watched folder's changes differ from what was last reported. */
let onChanged: (folder: string, changes: WorkstreamChanges) => void = () => {};

export function setWorkstreamChangesListener(listener: (folder: string, changes: WorkstreamChanges) => void): void {
  onChanged = listener;
}

const sameChanges = (a: WorkstreamChanges, b: WorkstreamChanges) =>
  a.base === b.base && a.truncated === b.truncated && a.files.length === b.files.length &&
  a.files.every((f, i) => f.path === b.files[i].path && f.status === b.files[i].status && f.from === b.files[i].from);

function recompute(folder: string, entry: Entry): void {
  const next = computeChanges(folder, entry.mainRef);
  const changed = !sameChanges(entry.changes, next);
  entry.changes = next;
  entry.computedAt = Date.now();
  if (changed) onChanged(folder, next);
}

/**
 * The changes in `folder`, from the watcher when it has one, otherwise
 * computed (and reused for a short while, unless `fresh`).
 */
export function getChanges(folder: string, mainRef: string | null, opts: { fresh?: boolean } = {}): WorkstreamChanges {
  let entry = entries.get(folder);
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
  // Updated in place: a watcher's callback holds this entry.
  entry.mainRef = mainRef;
  entry.changes = computeChanges(folder, mainRef);
  entry.computedAt = Date.now();
  return entry.changes;
}

function watch(folder: string, entry: Entry): void {
  const watcher = chokidar.watch(folder, {
    ignoreInitial: true,
    persistent: true,
    ignored: (p: string) => IGNORED.test(path.relative(folder, p)),
  });
  watcher.on('all', () => schedule(folder, entry));
  // A change made while chokidar was still scanning raises no event, and
  // the answer computed before it started would then stand until the next
  // edit. Ask git once more when the watcher is actually listening.
  watcher.on('ready', () => schedule(folder, entry));
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
      const created: Entry = { mainRef, changes: computeChanges(folder, mainRef), computedAt: Date.now(), watcher: null, timer: null };
      entries.set(folder, created);
      if (!isExternal(folder)) watch(folder, created);
      continue;
    }
    if (entry.mainRef !== mainRef) {
      entry.mainRef = mainRef;
      recompute(folder, entry);
    }
    if (!entry.watcher && !isExternal(folder)) watch(folder, entry);
  }
}

// ── Refs (A1.7a) ──────────────────────────────────────────────────────────

/** One refs watcher per repository, keyed by its common git dir. */
const refWatchers = new Map<string, { watcher: FSWatcher; timer: ReturnType<typeof setTimeout> | null }>();

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
export function watchRefs(repo: string): void {
  let common: string;
  try {
    common = canonical(path.resolve(repo, git(repo, ['rev-parse', '--git-common-dir']).trim()));
  } catch {
    return;
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
  externallyWatched = null;
}
