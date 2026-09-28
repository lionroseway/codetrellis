/**
 * What the TopBar workstreams strip shows (Phase 32 A1.3). Pure, so the
 * rules are tested without rendering.
 */

import type { ChangedFile, Workstream } from '@shared/types';

/** Chips beyond this collapse into "+N", which opens the same list. */
export const MAX_CHIPS = 5;

/**
 * The workstreams worth a chip, or none.
 *
 * A worktree with changes but no agent gets one (A1.4): it is a line of work
 * even when nobody is on it right now.
 *
 * The strip is for PARALLEL work. One agent in the main checkout is the
 * everyday case, and `ConnectedAgents` right beside it already says so; a
 * chip for it would repeat that and teach people to ignore the strip. So it
 * appears when work is somewhere other than the main checkout, when there is
 * more than one line of work, or when agents share a folder.
 */
export function stripWorkstreams(all: readonly Workstream[]): Workstream[] {
  // The main checkout with no agent in it is the person's own work, which
  // the canvas's "Working tree" summary already shows. A worktree an agent
  // left with changes in it is not: that is work nobody is looking at.
  const active = all.filter((w) => !w.idle && (w.agents.length > 0 || !w.main));
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

/** "3 files changed", or null when nothing has. */
export function changeWords(w: Pick<Workstream, 'changes'>): string | null {
  const n = w.changes.files.length;
  if (n === 0) return null;
  const count = w.changes.truncated ? `${n}+` : String(n);
  return `${count} file${n === 1 && !w.changes.truncated ? '' : 's'} changed`;
}

/** The one-letter mark a changed file carries, as git prints it. */
export function statusLetter(status: ChangedFile['status']): 'A' | 'M' | 'D' | 'R' {
  return status === 'added' ? 'A' : status === 'deleted' ? 'D' : status === 'renamed' ? 'R' : 'M';
}

/** How many changed files the details list before "and N more". */
export const MAX_LISTED_FILES = 8;
