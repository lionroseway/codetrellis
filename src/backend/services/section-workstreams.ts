/**
 * One plan, several worktrees (Phase 32 C5.1).
 *
 * A section of a plan (any item with children, or one task) can be given
 * the branch it is worked on; everything under it inherits that. Agents in
 * another worktree are not offered its tasks (`get_next_item`) and cannot
 * claim them (`claim_item`), and are told where the section is worked.
 *
 * The stored value is a branch name, never a folder: plan files are shared
 * across checkouts and machines, where a folder means nothing. It is
 * resolved to a workstream (a worktree, or a branch checked out nowhere)
 * against the ones CodeTrellis knows, so a root never comes from a request.
 *
 * Pure apart from what it is handed: the item lookup and the workstreams.
 */

import type { PlanItem, Workstream } from '@shared/types';
export { worktreeDirFor } from '../../shared/lib/branch-name';

/** A section's branch, and the item it is set on (the item itself, or an ancestor). */
export interface SectionWorkstream {
  branch: string;
  fromUid: string;
  fromTitle: string;
}

/** What `git check-ref-format --branch` would accept, near enough, and short. */
const BRANCH_RE = /^(?!\/|.*\/\/|.*\.\.|.*@\{|.*\.lock$|.*\/$|-)[A-Za-z0-9._/@+-]{1,100}$/;

/** A branch name as stored, or null when it is not one. For plan-file import and requests. */
export function cleanBranch(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const b = raw.trim();
  return BRANCH_RE.test(b) ? b : null;
}

/** The nearest branch set on this item or above it. */
export function resolveSection(item: PlanItem, getItem: (uid: string) => PlanItem | null): SectionWorkstream | null {
  let cur: PlanItem | null = item;
  const seen = new Set<string>();
  while (cur && !seen.has(cur.uid)) {
    seen.add(cur.uid);
    if (cur.workstream) return { branch: cur.workstream, fromUid: cur.uid, fromTitle: cur.title };
    cur = cur.parentUid ? getItem(cur.parentUid) : null;
  }
  return null;
}

/** The workstream checked out on a branch: a worktree first, else the branch itself. */
export function workstreamOfBranch(branch: string, workstreams: readonly Workstream[]): Workstream | null {
  return workstreams.find((w) => w.branch === branch && !w.root.startsWith('branch:'))
    ?? workstreams.find((w) => w.branch === branch)
    ?? null;
}

/** The branch a caller works on, from its workstream's root; null when unknown or detached. */
export function branchOfRoot(root: string | null | undefined, workstreams: readonly Workstream[]): string | null {
  if (!root) return null;
  return workstreams.find((w) => w.root === root)?.branch ?? null;
}

/** A section's place in words: "billing-v2 in /work/app-billing", or the branch alone. */
export function whereWorked(branch: string, workstreams: readonly Workstream[]): string {
  const w = workstreamOfBranch(branch, workstreams);
  if (w && !w.root.startsWith('branch:')) return `${branch} in ${w.root}`;
  if (w) return `${branch} (checked out in no worktree yet)`;
  return `${branch} (no worktree or branch of that name here yet)`;
}

/**
 * Why an agent may not claim this item, or null when it may: the item's
 * section is worked on another branch than the caller's. An unknown caller
 * branch (a client that reported no folder, or a detached checkout) is not
 * the section's branch either, and is told how to be.
 */
export function claimRefusal(
  item: PlanItem,
  section: SectionWorkstream | null,
  callerBranch: string | null,
  workstreams: readonly Workstream[],
): string | null {
  if (!section || section.branch === callerBranch) return null;
  const where = whereWorked(section.branch, workstreams);
  const lead = section.fromUid === item.uid
    ? `“${item.title}” is worked on ${where}`
    : `“${item.title}” is in “${section.fromTitle}”, which is worked on ${where}`;
  const you = callerBranch
    ? `You are working on ${callerBranch}.`
    : 'CodeTrellis cannot tell which worktree you are in: your client reported no folder, or its checkout is on no branch.';
  return `${lead}. ${you} Start a session there to claim it, or ask the person to move the section to your worktree.`;
}

/** For `get_next_item`: may this caller be offered the item? Unassigned sections, or its own. */
export function offeredTo(section: SectionWorkstream | null, callerBranch: string | null): boolean {
  return !section || section.branch === callerBranch;
}

/**
 * The tasks left out of `get_next_item` because they are worked elsewhere,
 * as one line: "3 in billing-v2, 1 in exports". Empty when none.
 */
export function elsewhereLine(branches: readonly string[]): string {
  const counts = new Map<string, number>();
  for (const b of branches) counts.set(b, (counts.get(b) ?? 0) + 1);
  return [...counts].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).map(([b, n]) => `${n} in ${b}`).join(', ');
}

/** The plan's base for a new worktree, when it is a usable ref; null means the main checkout's HEAD. */
export function usableBase(baseRef: string | null | undefined): string | null {
  if (!baseRef) return null;
  const b = baseRef.trim();
  if (/^[0-9a-f]{7,40}$/i.test(b)) return b;
  return cleanBranch(b);
}
