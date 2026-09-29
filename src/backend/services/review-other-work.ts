/**
 * Which workstream a review is about, and the other work in flight around it
 * (Phase 32 A5.2).
 *
 * The workstream under review is, in order:
 *  1. the branch the review's `after` side names (`commit:billing-v2`);
 *  2. the branch the plan's items name (`PlanItem.workstream`);
 *  3. the opened checkout itself.
 * A branch with a worktree is that folder, as signals name it; a branch with
 * no checkout here is `branch:<name>`.
 */

import fs from 'node:fs';
import path from 'node:path';
import { listWorktrees, type Worktree } from './worktree-service';
import { loadSignals } from './awareness-service';
import { otherWorkInFlight, type OtherWorkInFlight } from '../../shared/lib/other-work';

const SHA = /^[0-9a-f]{7,40}$/i;

const canon = (p: string): string => {
  if (p.startsWith('branch:')) return p;
  try { return fs.realpathSync.native(p); } catch { return p; }
};

function branchNamed(spec: string | undefined): string | null {
  if (!spec?.startsWith('commit:')) return null;
  const ref = spec.slice('commit:'.length);
  return ref && !SHA.test(ref) && !ref.includes('~') && !ref.includes('^') ? ref : null;
}

export function reviewTarget(
  projectPath: string,
  opts: { after?: string; itemWorkstreams?: Array<string | null | undefined> },
  worktrees: readonly Worktree[] = listWorktrees(projectPath),
): { root: string; name: string } {
  const named = branchNamed(opts.after) ?? opts.itemWorkstreams?.find((w): w is string => !!w) ?? null;
  if (named) {
    const wt = worktrees.find((w) => w.branch === named);
    return { root: wt ? wt.path : `branch:${named}`, name: named };
  }
  const main = worktrees.find((w) => w.isMain);
  if (main) return { root: main.path, name: main.branch ?? path.basename(main.path) };
  return { root: projectPath, name: path.basename(projectPath) };
}

/** The other work in flight for a review; null when awareness has nothing to say for this project. */
export function otherWorkFor(
  projectPath: string,
  opts: { after?: string; itemWorkstreams?: Array<string | null | undefined> },
): OtherWorkInFlight | null {
  let worktrees: Worktree[];
  try { worktrees = listWorktrees(projectPath); } catch { worktrees = []; }
  const target = reviewTarget(projectPath, opts, worktrees);
  const byPath = new Map(worktrees.map((w) => [canon(w.path), w]));
  const label = (root: string): string => {
    if (root.startsWith('branch:')) return root.slice('branch:'.length);
    const wt = byPath.get(canon(root));
    if (wt?.branch) return wt.branch;
    return root.split(/[\\/]/).filter(Boolean).pop() ?? root;
  };
  let signals;
  try { signals = loadSignals(projectPath); } catch { return null; }
  return otherWorkInFlight(target, signals, label, (a, b) => canon(a) === canon(b));
}
