/**
 * One plan across several worktrees, as a person reads it (Phase 32 C5.3):
 * which worktree each task is worked in (its section's, inherited), and how
 * far each worktree has got. Pure, so the tree, the header and the lanes say
 * the same thing.
 */

import type { PlanItem } from '@shared/types';

type ItemLike = Pick<PlanItem, 'uid' | 'parentUid' | 'kind' | 'status' | 'title'> & { workstream?: string | null };

/** The branch a task is worked on: its own, or the nearest section's above it. */
export function worktreeOf(uid: string, itemsByUid: Readonly<Record<string, ItemLike>>): string | null {
  const seen = new Set<string>();
  let cur: ItemLike | undefined = itemsByUid[uid];
  while (cur && !seen.has(cur.uid)) {
    seen.add(cur.uid);
    if (cur.workstream) return cur.workstream;
    cur = cur.parentUid ? itemsByUid[cur.parentUid] : undefined;
  }
  return null;
}

export interface WorktreeProgress {
  /** The branch, or null for tasks no section keeps to one worktree. */
  branch: string | null;
  done: number;
  total: number;
}

/**
 * Tasks done out of tasks to do, per worktree; skipped tasks are not counted.
 * Worktrees in branch order, then "any worktree" last. Empty when no section
 * names a worktree: a plan in one place needs no split.
 */
export function progressByWorktree(itemsByUid: Readonly<Record<string, ItemLike>>): WorktreeProgress[] {
  const groups = new Map<string | null, WorktreeProgress>();
  for (const item of Object.values(itemsByUid)) {
    if (item.kind !== 'action' || item.status === 'skipped') continue;
    const branch = worktreeOf(item.uid, itemsByUid);
    const g = groups.get(branch) ?? { branch, done: 0, total: 0 };
    g.total += 1;
    if (item.status === 'done') g.done += 1;
    groups.set(branch, g);
  }
  if (![...groups.keys()].some((b) => b !== null)) return [];
  return [...groups.values()].sort((a, b) => (a.branch === null ? 1 : b.branch === null ? -1 : a.branch.localeCompare(b.branch)));
}

/** "checkout-v2-billing: 3 of 5 · exports: 1 of 4 · any worktree: 2 of 3". */
export function progressLine(groups: readonly WorktreeProgress[]): string {
  return groups.map((g) => `${g.branch ?? 'any worktree'}: ${g.done} of ${g.total}`).join(' · ');
}

/** The sections of this plan kept to each branch, by title, for the Timeline lanes. */
export function sectionsByBranch(itemsByUid: Readonly<Record<string, ItemLike>>): Map<string, string[]> {
  const out = new Map<string, string[]>();
  for (const item of Object.values(itemsByUid)) {
    if (!item.workstream) continue;
    out.set(item.workstream, [...(out.get(item.workstream) ?? []), item.title]);
  }
  for (const titles of out.values()) titles.sort((a, b) => a.localeCompare(b));
  return out;
}
