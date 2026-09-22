/**
 * Plans grouped by where they live: this checkout, the repo's other
 * worktrees, or another project entirely.
 *
 * A plan is stored against the root it was created under, so the Plans
 * panel only ever showed the open checkout's plans and a plan written in a
 * sibling worktree (the usual shape for parallel agents) was invisible.
 * The plan switcher and the Plans tab both group through here, so they
 * cannot disagree about which plan belongs to which branch.
 *
 * Shape of a worktree matches `backend/services/worktree-service.ts`.
 */

import type { Plan } from '@shared/types';

export interface WorktreePlanSummary {
  uid: string;
  title: string;
  status: string;
}

export interface WorktreeInfo {
  path: string;
  branch: string | null;
  head: string | null;
  isMain: boolean;
  isCurrent: boolean;
  plans: WorktreePlanSummary[];
}

type PlanLike = Pick<Plan, 'uid' | 'title' | 'status' | 'projectPath'>;

export interface WorktreeGroup<P extends PlanLike = PlanLike> {
  worktree: WorktreeInfo;
  /** Plans already in this app's database for this worktree. */
  plans: P[];
  /**
   * Plans on this worktree's disk that are not in the database yet:
   * written by an agent there, or committed on that branch. Opening the
   * worktree offers to import them.
   */
  onDiskOnly: WorktreePlanSummary[];
}

export interface GroupedPlans<P extends PlanLike = PlanLike> {
  /** The open checkout. Null when the project is not a git repo. */
  current: WorktreeGroup<P> | null;
  /** The repo's other worktrees, main checkout first. */
  otherWorktrees: WorktreeGroup<P>[];
  /** Plans for projects that are not a worktree of this repo. */
  otherProjects: P[];
  /** Plans for this root when there is no worktree information. */
  here: P[];
}

function norm(p: string): string {
  return p.replace(/[\\/]+$/, '');
}

export function groupPlansByWorktree<P extends PlanLike>(
  plans: P[],
  worktrees: WorktreeInfo[],
  root: string | null,
): GroupedPlans<P> {
  const known = new Set(plans.map((p) => p.uid));
  const byPath = new Map<string, P[]>();
  for (const p of plans) {
    const key = norm(p.projectPath || '');
    byPath.set(key, [...(byPath.get(key) ?? []), p]);
  }

  const groups = worktrees.map((wt) => ({
    worktree: wt,
    plans: byPath.get(norm(wt.path)) ?? [],
    onDiskOnly: wt.plans.filter((d) => !known.has(d.uid)),
  }));
  const claimed = new Set(worktrees.map((w) => norm(w.path)));

  const current = groups.find((g) => g.worktree.isCurrent) ?? null;
  const otherWorktrees = groups
    .filter((g) => !g.worktree.isCurrent)
    .sort((a, b) => Number(b.worktree.isMain) - Number(a.worktree.isMain));

  const rootKey = root ? norm(root) : null;
  // Without worktree info (not a repo, or still loading) this root's plans
  // are still "here"; they must not fall into "other projects".
  const here = current ? current.plans : rootKey ? byPath.get(rootKey) ?? [] : [];
  const otherProjects = plans.filter((p) => {
    const key = norm(p.projectPath || '');
    return !claimed.has(key) && key !== rootKey;
  });

  return { current, otherWorktrees, otherProjects, here };
}

/** A worktree's name as a person says it: its branch, else its folder. */
export function worktreeLabel(wt: Pick<WorktreeInfo, 'branch' | 'path'>): string {
  return wt.branch || wt.path.split(/[\\/]/).pop() || wt.path;
}

export async function fetchWorktrees(root: string): Promise<WorktreeInfo[]> {
  try {
    const res = await fetch(`/api/git/worktrees?project=${encodeURIComponent(root)}`);
    if (!res.ok) return [];
    const body = await res.json();
    return Array.isArray(body) ? (body as WorktreeInfo[]) : [];
  } catch {
    return [];
  }
}

/**
 * Open a worktree as a project tab, or switch to it if it already is one.
 *
 * The branch popover opened a NEW tab on every click, so opening the same
 * worktree twice gave two tabs scanning the same directory.
 */
export async function openWorktreeTab(wtPath: string, branch: string | null): Promise<void> {
  const { useProjectStore } = await import('../stores/project-store');
  const { getAPI } = await import('../bridge');
  const store = useProjectStore.getState();
  const existing = store.tabs.find((t) => norm(t.root) === norm(wtPath));
  if (existing) {
    store.setActiveTab(existing.id);
    return;
  }
  store.addTab(wtPath, branch);
  store.setScanStatus('scanning');
  try {
    store.applyScanResult(await getAPI().scanProject(wtPath));
  } catch (err) {
    store.setError(String(err));
  }
}
