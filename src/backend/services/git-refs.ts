/**
 * Any ref on either side (Phase 32 E2).
 *
 * The points a person can compare, beyond this checkout's own: every local
 * branch, every remote-tracking branch as last fetched, every tag, each
 * other worktree's working copy as it is now, and where two of them split
 * (their merge base). Each is a comparand spec the rest of the app already
 * reads (`/api/file/at`, `/api/compare`), so the code view and the graph
 * compare the same two:
 *
 *  - `live`, `index`, `commit:HEAD`: this checkout (E1);
 *  - `commit:refs/heads/<b>`, `commit:refs/remotes/<r>/<b>`,
 *    `commit:refs/tags/<t>`: full ref names, so a tag and a branch with the
 *    same name never mix;
 *  - `workstream:<id>`: another worktree's working copy (the id
 *    `listWorkstreams` gave it, never a folder from a request);
 *  - `merge-base:<a>...<b>`: where `a` and `b` split, as `git diff a...b`
 *    means it.
 *
 * Every side reads two ways (Track E): a plain label ("billing-v2, a
 * worktree codex works in") and git's own word and command beside it.
 *
 * A working copy is compared as a tree: its files are written into a
 * temporary index (a copy of its own, so unchanged files are not re-read)
 * and `git write-tree` names them, as `git stash create` does. That writes
 * blobs into the repository's object store, which `git gc` clears; the
 * checkout, its index and its refs are never touched.
 */

import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { Workstream } from '../../shared/types';
import { isSafeGitRef } from './git-safety';
import { parseNameStatus, type SourceFile } from './source-control';
import { listWorktrees } from './worktree-service';

export type RefKind = 'checkout' | 'branch' | 'remote' | 'tag' | 'worktree' | 'commit';

export interface GitRef {
  /** The comparand: what `/api/file/at`'s `at` and `/api/compare`'s sides take. */
  spec: string;
  kind: RefKind;
  /** As git shows it: `main`, `origin/main`, `v1.2`, a worktree's branch. */
  name: string;
  /** For a person: what this side is. */
  words: string;
  /** Git's word for it (`branch`, `remote-tracking`, `tag`, `worktree`, `HEAD`…). */
  term: string;
  sha: string | null;
  /** When it last changed (its commit's time), ms. */
  at: number | null;
  subject: string | null;
  /** This checkout's branch. */
  current?: boolean;
  /** Who works in it, for a worktree. */
  agents?: string[];
}

export interface RefGroup {
  kind: RefKind;
  title: string;
  /** What the group is, and git's command that lists the same. */
  words: string;
  git: { term: string; command: string };
  refs: GitRef[];
}

export interface RefListing {
  project: string;
  git: boolean;
  branch: string | null;
  groups: RefGroup[];
  /** When remotes were last fetched, ms; null when never. */
  fetchedAt: number | null;
}

/** At most this many of each kind, newest first. */
const MAX_PER_KIND = 200;
const MAX_FILES = 1000;
const SHA = /^[0-9a-f]{7,64}$/;

function git(cwd: string, args: string[], env?: NodeJS.ProcessEnv): string {
  return execFileSync('git', args, {
    cwd, encoding: 'utf-8', maxBuffer: 64 * 1024 * 1024, stdio: ['ignore', 'pipe', 'ignore'],
    ...(env ? { env: { ...process.env, ...env } } : {}),
  });
}

const trim = (p: string) => p.replace(/[\\/]+$/, '');
const short = (sha: string | null) => (sha ? sha.slice(0, 7) : '');

/** A full ref name as git shows it on its own: `refs/heads/x` → `x`. */
export function shortRefName(ref: string): string {
  if (ref.startsWith('refs/heads/')) return ref.slice('refs/heads/'.length);
  if (ref.startsWith('refs/remotes/')) return ref.slice('refs/remotes/'.length);
  if (ref.startsWith('refs/tags/')) return ref.slice('refs/tags/'.length);
  return ref;
}

/** A merge-base spec's two refs, each checked; null when it is not one. */
export function parseMergeBase(spec: string): { a: string; b: string } | null {
  if (!spec.startsWith('merge-base:')) return null;
  const parts = spec.slice('merge-base:'.length).split('...');
  if (parts.length !== 2 || !isSafeGitRef(parts[0]) || !isSafeGitRef(parts[1])) return null;
  return { a: parts[0], b: parts[1] };
}

/** Where `a` and `b` split, or null when they share no history (or either is unknown). */
export function mergeBase(projectRoot: string, a: string, b: string): string | null {
  if (!isSafeGitRef(a) || !isSafeGitRef(b)) return null;
  try {
    const sha = git(projectRoot, ['merge-base', a, b]).trim();
    return SHA.test(sha) ? sha : null;
  } catch {
    return null;
  }
}

/** A worktree among the project's, by the id `listWorkstreams` gave it. */
export function findWorkstream(workstreams: readonly Workstream[], id: string): Workstream | null {
  return workstreams.find((w) => w.root === id) ?? null;
}

/**
 * The worktrees git lists, as the comparison needs them (root, branch,
 * head), with no agents placed and no watchers started.
 */
export function worktreesForCompare(projectRoot: string): Workstream[] {
  try {
    return listWorktrees(projectRoot).filter((w) => !w.bare && !w.prunable).map((w) => ({
      root: w.path, branch: w.branch, head: w.head, main: w.isMain, shape: 'worktree', agents: [], idle: false,
      changes: { base: null, files: [], truncated: false },
    }) as unknown as Workstream);
  } catch {
    return [];
  }
}

/**
 * A working copy as a tree: its tracked and untracked files (ignored ones
 * left out, as `git status` leaves them), written through a temporary copy
 * of its own index. Null when it is not a git working tree.
 */
export function workingCopyTree(root: string): string | null {
  let tmp: string | null = null;
  try {
    const indexPath = path.resolve(root, git(root, ['rev-parse', '--git-path', 'index']).trim());
    tmp = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'ct-tree-')), 'index');
    // Its own index carries what it has staged and each file's stat, so
    // unchanged files are not hashed again; a new repository has none.
    if (fs.existsSync(indexPath)) fs.copyFileSync(indexPath, tmp);
    const env = { GIT_INDEX_FILE: tmp };
    git(root, ['add', '-A', '--', ':/'], env);
    const tree = git(root, ['write-tree'], env).trim();
    return SHA.test(tree) ? tree : null;
  } catch {
    return null;
  } finally {
    if (tmp) fs.rmSync(path.dirname(tmp), { recursive: true, force: true });
  }
}

/** The index as a tree (what is staged), without touching it. */
function indexTree(root: string): string | null {
  try {
    const tree = git(root, ['write-tree']).trim();
    return SHA.test(tree) ? tree : null;
  } catch {
    return null;
  }
}

/**
 * What git object a side names, for listing and diffing its files: a
 * commit or a tree. `live` and a worktree are their working copies; `none`
 * is the empty tree. Null when the side does not resolve.
 */
export function treeOf(projectRoot: string, spec: string, workstreams: readonly Workstream[]): string | null {
  if (spec === 'live') return workingCopyTree(projectRoot);
  if (spec === 'index') return indexTree(projectRoot);
  if (spec === 'none') {
    // The empty tree, from no input (its id depends on the repository's hash).
    try { return git(projectRoot, ['hash-object', '-t', 'tree', '--stdin']).trim() || null; } catch { return null; }
  }
  if (spec.startsWith('commit:')) {
    const ref = spec.slice('commit:'.length);
    if (!isSafeGitRef(ref)) return null;
    try {
      const sha = git(projectRoot, ['rev-parse', '--verify', '--quiet', `${ref}^{commit}`]).trim();
      return SHA.test(sha) ? sha : null;
    } catch {
      return null;
    }
  }
  const mb = parseMergeBase(spec);
  if (mb) return mergeBase(projectRoot, mb.a, mb.b);
  if (spec.startsWith('workstream:')) {
    const w = findWorkstream(workstreams, spec.slice('workstream:'.length));
    if (!w) return null;
    if (w.root.startsWith('branch:')) return w.head && SHA.test(w.head) ? w.head : null;
    if (trim(w.root) === trim(projectRoot)) return workingCopyTree(projectRoot);
    return workingCopyTree(w.root);
  }
  return null;
}

/** A side as git names it in a command: `main`, `origin/main`, `a...b`. */
function gitName(spec: string, workstreams: readonly Workstream[]): string | null {
  if (spec.startsWith('commit:')) return shortRefName(spec.slice('commit:'.length));
  const mb = parseMergeBase(spec);
  if (mb) return `$(git merge-base ${shortRefName(mb.a)} ${shortRefName(mb.b)})`;
  if (spec.startsWith('workstream:')) {
    const w = findWorkstream(workstreams, spec.slice('workstream:'.length));
    return w?.branch ?? null;
  }
  return null;
}

/**
 * The git command that shows the same diff, for whoever wants to run it or
 * learn it. Null when no one command does (two working copies).
 */
export function diffCommand(before: string, after: string, workstreams: readonly Workstream[], file?: string): string | null {
  const tail = file ? ` -- ${file}` : '';
  const mb = parseMergeBase(before);
  // From where two refs split to the second: git's three dots.
  if (mb && after.startsWith('commit:') && shortRefName(after.slice('commit:'.length)) === shortRefName(mb.b)) {
    return `git diff ${shortRefName(mb.a)}...${shortRefName(mb.b)}${tail}`;
  }
  if (before === 'index' && after === 'live') return `git diff${tail}`;
  if (before === 'commit:HEAD' && after === 'index') return `git diff --cached${tail}`;
  const b = gitName(before, workstreams);
  if (after === 'live' && b && !before.startsWith('workstream:')) return `git diff ${b}${tail}`;
  if (after === 'index' && b && !before.startsWith('workstream:')) return `git diff --cached ${b}${tail}`;
  if (after.startsWith('workstream:')) {
    const w = findWorkstream(workstreams, after.slice('workstream:'.length));
    if (w && !w.root.startsWith('branch:') && b && !before.startsWith('workstream:')) return `git -C ${w.root} diff ${b}${tail}`;
  }
  const a = gitName(after, workstreams);
  if (b && a && !before.startsWith('workstream:') && !after.startsWith('workstream:')) return `git diff ${b} ${a}${tail}`;
  return null;
}

/** What a side is, in a few words, for the header above a diff. */
export function sideLabel(projectRoot: string, spec: string, workstreams: readonly Workstream[]): string {
  if (spec === 'live') return 'Your working copy';
  if (spec === 'index') return 'Staged';
  if (spec === 'none') return 'Nothing';
  if (spec === 'commit:HEAD') {
    try { return `Last commit (${short(git(projectRoot, ['rev-parse', 'HEAD']).trim())})`; } catch { return 'Last commit'; }
  }
  const mb = parseMergeBase(spec);
  if (mb) {
    const sha = mergeBase(projectRoot, mb.a, mb.b);
    return `Where ${shortRefName(mb.a)} and ${shortRefName(mb.b)} split${sha ? ` (${short(sha)})` : ''}`;
  }
  if (spec.startsWith('workstream:')) {
    const w = findWorkstream(workstreams, spec.slice('workstream:'.length));
    return w ? `${w.branch ?? path.basename(w.root)}, its working copy` : 'A worktree';
  }
  if (spec.startsWith('commit:')) {
    const ref = spec.slice('commit:'.length);
    if (ref.startsWith('refs/remotes/')) return `${shortRefName(ref)} (remote, as last fetched)`;
    if (ref.startsWith('refs/tags/')) return `Tag ${shortRefName(ref)}`;
    if (ref.startsWith('refs/heads/')) return shortRefName(ref);
    return SHA.test(ref) ? `Commit ${short(ref)}` : ref;
  }
  return spec;
}

/**
 * The files that differ between two sides, relative to the project (a
 * project in a subfolder of its repository lists only its own).
 */
export function filesBetween(
  projectRoot: string,
  before: string,
  after: string,
  workstreams: readonly Workstream[],
): { ok: true; files: SourceFile[]; truncated: boolean } | { ok: false; error: string } {
  const a = treeOf(projectRoot, before, workstreams);
  if (!a) return { ok: false, error: `Could not read “${sideLabel(projectRoot, before, workstreams)}”: it is not a ref, worktree or point this repository has.` };
  const b = treeOf(projectRoot, after, workstreams);
  if (!b) return { ok: false, error: `Could not read “${sideLabel(projectRoot, after, workstreams)}”: it is not a ref, worktree or point this repository has.` };
  let out: string;
  try {
    out = git(projectRoot, ['diff-tree', '-r', '-z', '-M', '--name-status', '--relative', a, b]);
  } catch {
    return { ok: false, error: 'git could not compare these two.' };
  }
  const files = parseNameStatus(out, '');
  return { ok: true, files: files.slice(0, MAX_FILES), truncated: files.length > MAX_FILES };
}

/** When remotes were last fetched here (FETCH_HEAD's time, whoever fetched), ms; null when never. */
export function fetchedAt(projectRoot: string): number | null {
  try {
    const p = path.resolve(projectRoot, git(projectRoot, ['rev-parse', '--git-path', 'FETCH_HEAD']).trim());
    return fs.existsSync(p) ? fs.statSync(p).mtimeMs : null;
  } catch {
    return null;
  }
}

export function whenWords(ms: number | null, now: number): string {
  if (ms === null) return 'never';
  const mins = Math.round((now - ms) / 60_000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins} min ago`;
  const hours = Math.round(mins / 60);
  if (hours < 48) return `${hours} h ago`;
  return `${Math.round(hours / 24)} days ago`;
}

/**
 * Every point a person can compare in this project, grouped as git groups
 * them, each group with git's command that lists the same.
 */
export function listRefs(projectRoot: string, workstreams: readonly Workstream[], now = Date.now()): RefListing {
  let branch: string | null = null;
  let head: string | null = null;
  try {
    head = git(projectRoot, ['rev-parse', 'HEAD']).trim();
  } catch { /* no commit yet */ }
  try {
    branch = git(projectRoot, ['symbolic-ref', '--short', '-q', 'HEAD']).trim() || null;
  } catch { /* detached, or not a repository */ }
  try {
    git(projectRoot, ['rev-parse', '--git-dir']);
  } catch {
    return { project: projectRoot, git: false, branch: null, groups: [], fetchedAt: null };
  }

  const groups: RefGroup[] = [];
  const headSubject = head ? (() => { try { return git(projectRoot, ['log', '-1', '--format=%s']).trim(); } catch { return null; } })() : null;
  groups.push({
    kind: 'checkout', title: 'This checkout', words: `Your working copy, what is staged, and the last commit${branch ? ` on ${branch}` : ''}`,
    git: { term: 'HEAD', command: 'git status' },
    refs: [
      { spec: 'live', kind: 'checkout', name: 'Working copy', words: 'Your files as they are now, saved or not committed', term: 'working tree', sha: null, at: null, subject: null },
      { spec: 'index', kind: 'checkout', name: 'Staged', words: 'What goes into the next commit', term: 'index', sha: null, at: null, subject: null },
      ...(head ? [{ spec: 'commit:HEAD', kind: 'checkout' as const, name: 'Last commit', words: `${short(head)} “${headSubject ?? ''}”`, term: 'HEAD', sha: short(head), at: null, subject: headSubject }] : []),
    ],
  });

  const fetched = fetchedAt(projectRoot);
  let rows: string[] = [];
  try {
    rows = git(projectRoot, [
      'for-each-ref', '--sort=-creatordate',
      '--format=%(refname)%00%(objectname)%00%(*objectname)%00%(creatordate:unix)%00%(subject)',
      'refs/heads', 'refs/remotes', 'refs/tags',
    ]).split('\n').filter(Boolean);
  } catch { /* no refs */ }
  const byKind: Record<'branch' | 'remote' | 'tag', GitRef[]> = { branch: [], remote: [], tag: [] };
  for (const row of rows) {
    const [ref, obj, peeled, unix, subject] = row.split('\0');
    if (!isSafeGitRef(ref) || ref.endsWith('/HEAD')) continue;
    const kind = ref.startsWith('refs/heads/') ? 'branch' : ref.startsWith('refs/remotes/') ? 'remote' : 'tag';
    if (byKind[kind].length >= MAX_PER_KIND) continue;
    const name = shortRefName(ref);
    const at = unix ? Number(unix) * 1000 : null;
    const sha = short(peeled || obj);
    const when = whenWords(at, now);
    byKind[kind].push({
      spec: `commit:${ref}`, kind, name, sha, at, subject: subject || null,
      current: kind === 'branch' && name === branch,
      term: kind === 'remote' ? 'remote-tracking branch' : kind,
      words: kind === 'branch' ? `A branch here, last changed ${when}`
        : kind === 'remote' ? `${name.split('/')[0]}'s ${name.split('/').slice(1).join('/')}, as last fetched (${whenWords(fetched, now)})`
          : `A tag, made ${when}`,
    });
  }
  groups.push({ kind: 'branch', title: 'Branches', words: 'Branches in this repository', git: { term: 'branch', command: 'git branch' }, refs: byKind.branch });
  if (byKind.remote.length) {
    groups.push({
      kind: 'remote', title: 'Remote branches',
      words: `Other copies' branches as this repository last fetched them: ${fetched === null ? 'never fetched' : `fetched ${whenWords(fetched, now)}`}`,
      git: { term: 'remote-tracking', command: 'git branch -r' }, refs: byKind.remote,
    });
  }
  if (byKind.tag.length) groups.push({ kind: 'tag', title: 'Tags', words: 'Named points, usually releases', git: { term: 'tag', command: 'git tag' }, refs: byKind.tag });

  const worktrees = workstreams.filter((w) => !w.root.startsWith('branch:') && !w.main && trim(w.root) !== trim(projectRoot) && !trim(projectRoot).startsWith(`${trim(w.root)}/`));
  if (worktrees.length) {
    groups.push({
      kind: 'worktree', title: 'Worktrees', words: 'Other working copies of this repository, as they are now, saved or not committed',
      git: { term: 'worktree', command: 'git worktree list' },
      refs: worktrees.map((w) => {
        const agents = [...new Set(w.agents.map((a) => a.agentType))];
        return {
          spec: `workstream:${w.root}`, kind: 'worktree' as const, name: w.branch ?? path.basename(w.root), sha: w.head ? short(w.head) : null, at: null, subject: null,
          term: 'worktree', agents,
          words: `A worktree at ${w.root}${agents.length ? `, worked on by ${agents.join(' and ')}` : ''}: its files now, committed or not`,
        };
      }),
    });
  }
  return { project: projectRoot, git: true, branch, groups, fetchedAt: fetched };
}
