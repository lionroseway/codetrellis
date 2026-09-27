/**
 * What the TopBar workstreams strip shows (Phase 32 A1.3). Pure, so the
 * rules are tested without rendering.
 */

import type { Workstream } from '@shared/types';

/** Chips beyond this collapse into "+N", which opens the same list. */
export const MAX_CHIPS = 5;

/**
 * The workstreams worth a chip, or none.
 *
 * The strip is for PARALLEL work. One agent in the main checkout is the
 * everyday case, and `ConnectedAgents` right beside it already says so; a
 * chip for it would repeat that and teach people to ignore the strip. So it
 * appears when work is somewhere other than the main checkout, when there is
 * more than one line of work, or when agents share a folder.
 */
export function stripWorkstreams(all: readonly Workstream[]): Workstream[] {
  const active = all.filter((w) => !w.idle);
  if (active.length === 0) return [];
  if (active.length === 1 && active[0].main && active[0].shape !== 'shared') return [];
  return active;
}

/** The chip's name: the branch, or the commit when detached. */
export function chipLabel(w: Pick<Workstream, 'branch' | 'head'>): string {
  if (w.branch) return w.branch;
  return w.head ? `detached ${w.head.slice(0, 7)}` : 'detached';
}

/** One line saying what kind of workstream it is. */
export function shapeWords(w: Pick<Workstream, 'main' | 'shape' | 'agents'>): string {
  const where = w.main ? 'Main checkout' : 'Worktree';
  if (w.shape === 'shared') return `${where}, shared by ${w.agents.length} agents`;
  return where;
}

/** The warning a shared checkout carries, or null. */
export function sharedNote(w: Pick<Workstream, 'shape'>): string | null {
  return w.shape === 'shared'
    ? "Their edits in this folder can't be told apart. Give one of them a worktree of its own."
    : null;
}

/**
 * A folder shortened from the left, so the part that tells worktrees apart
 * (their own name, at the end) is what stays.
 */
export function shortFolder(folder: string, max = 40): string {
  return folder.length <= max ? folder : `…${folder.slice(folder.length - (max - 1))}`;
}
