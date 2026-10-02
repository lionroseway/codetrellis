/**
 * A workstream's name as a person knows it (Phase 32 A1.3, shared in B4.4):
 * the branch, or the folder. Shared by the desktop and the phone so a held
 * call names the same workstream on both.
 */

import type { Workstream } from '../types';

/** The chip's name: the branch, or the commit when detached. */
export function chipLabel(w: Pick<Workstream, 'branch' | 'head'>): string {
  if (w.branch) return w.branch;
  return w.head ? `detached ${w.head.slice(0, 7)}` : 'detached';
}

/**
 * The name of one side of a signal. Signals name workstreams by root: a
 * folder, or `branch:<name>` for a branch with no checkout.
 */
export function sideLabel(root: string, workstreams: readonly Workstream[]): string {
  const ws = workstreams.find((w) => w.root === root);
  if (ws) return chipLabel(ws);
  if (root.startsWith('branch:')) return root.slice('branch:'.length);
  return root.split(/[\\/]/).filter(Boolean).pop() ?? root;
}
