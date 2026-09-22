/**
 * Git worktrees of an opened project, and the plans each one holds.
 *
 * WHY
 *
 * A plan is stored against the exact root it was created under. Open one
 * checkout of a repo and the Plans panel showed that checkout's plans and
 * nothing else — a plan for the same repo, written in a sibling worktree
 * on another branch, was invisible unless you knew to open that worktree
 * as its own project first. Parallel agents working in worktrees is the
 * ordinary case this product is built for, so "which plans exist for this
 * repo, and on which branch" has to be answerable from any checkout.
 *
 * WHY `git worktree list`, NOT READING `.git/worktrees`
 *
 * `/api/git/info` reads `.git/worktrees/*` by hand. That only works from
 * the MAIN checkout: in a linked worktree `.git` is a file, not a
 * directory, so it found no siblings at all, and it never lists the main
 * checkout itself. Porcelain output is the same from every checkout.
 *
 * CONFINEMENT
 *
 * Worktree roots come from git, never from the request, and each one is
 * checked to point back at this repository (see `belongsToRepo`): the
 * caller names
 * an opened project (confined upstream by `requireProjectRoot`), and the
 * siblings are derived from its repository. Plan files inside a sibling
 * are read through `confined-fs`, so a symlinked `.codetrellis/plans/x`
 * cannot point the read outside that worktree. This reads plan TITLES; it
 * does not import anything or open the worktree — that stays a visible
 * user action (opening it as a tab).
 */

import { execFileSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { parse as parseYaml } from 'yaml';

import { canonicalRoot, readTextWithin, resolveWithin } from './confined-fs';

export interface Worktree {
  path: string;
  /** Short branch name, or null when detached. */
  branch: string | null;
  head: string | null;
  /** The first entry git lists: the main working tree. */
  isMain: boolean;
  /** The checkout the caller has open. */
  isCurrent: boolean;
  bare: boolean;
  /** Git knows the directory is gone (`worktree prune` would remove it). */
  prunable: boolean;
}

export interface WorktreePlanSummary {
  uid: string;
  title: string;
  status: string;
}

export interface WorktreeWithPlans extends Worktree {
  /** Plans on disk in this worktree's `.codetrellis/plans/`. */
  plans: WorktreePlanSummary[];
}

/**
 * Parse `git worktree list --porcelain`.
 *
 * Records are blank-line separated; each starts with `worktree <path>`.
 * Pure, so the format is pinned by a unit test rather than by whatever
 * git is installed on the machine running the suite.
 */
export function parseWorktreePorcelain(out: string, currentRoot: string): Worktree[] {
  const current = safeCanonical(currentRoot);
  const result: Worktree[] = [];
  for (const block of out.split(/\n\s*\n/)) {
    const lines = block.split('\n').map((l) => l.trim()).filter(Boolean);
    const first = lines.find((l) => l.startsWith('worktree '));
    if (!first) continue;
    const wtPath = first.slice('worktree '.length);
    const branchLine = lines.find((l) => l.startsWith('branch '));
    const headLine = lines.find((l) => l.startsWith('HEAD '));
    result.push({
      path: wtPath,
      branch: branchLine ? branchLine.slice('branch '.length).replace(/^refs\/heads\//, '') : null,
      head: headLine ? headLine.slice('HEAD '.length) : null,
      isMain: result.length === 0,
      isCurrent: safeCanonical(wtPath) === current,
      bare: lines.includes('bare'),
      prunable: lines.some((l) => l === 'prunable' || l.startsWith('prunable ')),
    });
  }
  return result;
}

function safeCanonical(p: string): string {
  try {
    return canonicalRoot(p);
  } catch {
    return path.resolve(p);
  }
}

function git(projectRoot: string, args: string[]): string {
  // execFile, no shell; `-C <root>` where root is a confined project root.
  return execFileSync('git', ['-C', projectRoot, ...args], {
    encoding: 'utf-8',
    stdio: ['ignore', 'pipe', 'ignore'],
    timeout: 5000,
  });
}

/**
 * Does `wt` really belong to the repository whose common git dir is
 * `commonDir`?
 *
 * `git worktree list` reports whatever `.git/worktrees/<name>/gitdir`
 * says, and a cloned repository can ship that directory hand-written,
 * pointing at any path on the machine. Everything downstream (reading
 * plan titles, offering "Open worktree") would then act on a directory
 * the user never made a worktree of. So the claim is checked from the
 * other side: a linked worktree's own `.git` FILE must point back into
 * `<commonDir>/worktrees/`, and the main checkout's `.git` must BE the
 * common dir. Plain file reads (lstat first, so a symlinked `.git` is
 * refused); git is not run inside the candidate directory.
 */
export function belongsToRepo(wt: Pick<Worktree, 'path' | 'isMain'>, commonDir: string): boolean {
  try {
    const wtRoot = fs.realpathSync.native(wt.path);
    const dotGit = path.join(wtRoot, '.git');
    const st = fs.lstatSync(dotGit);
    if (wt.isMain) {
      return st.isDirectory() && fs.realpathSync.native(dotGit) === commonDir;
    }
    if (!st.isFile()) return false;
    const m = /^gitdir:\s*(.+)\s*$/m.exec(fs.readFileSync(dotGit, 'utf-8'));
    if (!m) return false;
    const target = fs.realpathSync.native(path.resolve(wtRoot, m[1].trim()));
    return path.dirname(target) === path.join(commonDir, 'worktrees');
  } catch {
    return false;
  }
}

/** Worktrees of the repository containing `projectRoot`. Empty if not a repo. */
export function listWorktrees(projectRoot: string): Worktree[] {
  let out: string;
  let commonDir: string;
  try {
    out = git(projectRoot, ['worktree', 'list', '--porcelain']);
    commonDir = fs.realpathSync.native(
      path.resolve(projectRoot, git(projectRoot, ['rev-parse', '--git-common-dir']).trim()),
    );
  } catch {
    return [];
  }
  return parseWorktreePorcelain(out, projectRoot).filter((w) => w.bare || w.prunable || belongsToRepo(w, commonDir));
}

/** Plan summaries on disk in one worktree. Never throws. */
export function readWorktreePlans(worktreeRoot: string): WorktreePlanSummary[] {
  let plansDir: string;
  try {
    plansDir = resolveWithin(worktreeRoot, path.join('.codetrellis', 'plans'), 'plans dir');
  } catch {
    return [];
  }
  if (!fs.existsSync(plansDir)) return [];

  const plans: WorktreePlanSummary[] = [];
  let entries: fs.Dirent[] = [];
  try {
    entries = fs.readdirSync(plansDir, { withFileTypes: true });
  } catch {
    return [];
  }
  for (const entry of entries) {
    // A symlinked plan directory is skipped, not followed: `isDirectory` on
    // a Dirent is false for a link, and the read below is confined anyway.
    if (!entry.isDirectory()) continue;
    try {
      const text = readTextWithin(worktreeRoot, path.join('.codetrellis', 'plans', entry.name, 'plan.yaml'), 'plan.yaml');
      const doc = parseYaml(text) as { uid?: unknown; title?: unknown; status?: unknown } | null;
      if (!doc || typeof doc.uid !== 'string') continue;
      plans.push({
        uid: doc.uid,
        title: typeof doc.title === 'string' ? doc.title : entry.name,
        status: typeof doc.status === 'string' ? doc.status : 'draft',
      });
    } catch {
      // Unreadable, not a plan, or refused by confinement — skip it.
    }
  }
  return plans;
}

/**
 * Every usable worktree of the repo, each with the plans on its disk.
 *
 * Bare and prunable entries are dropped: there is no checkout to read or
 * to open.
 */
export function listWorktreesWithPlans(projectRoot: string): WorktreeWithPlans[] {
  return listWorktrees(projectRoot)
    .filter((w) => !w.bare && !w.prunable && fs.existsSync(w.path))
    .map((w) => ({ ...w, plans: readWorktreePlans(w.path) }));
}
