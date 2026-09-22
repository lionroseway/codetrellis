import { useEffect, useMemo, useState } from 'react';

import { usePlanStore } from '../stores/plan-store';
import { useProjectStore } from '../stores/project-store';
import { fetchWorktrees, groupPlansByWorktree, type WorktreeInfo } from '../lib/plan-worktrees';

/**
 * Every plan the app knows, grouped by checkout. See `lib/plan-worktrees`.
 *
 * Refetches the worktree list when the project changes and when the plan
 * count does: a plan created or imported in a sibling moves between
 * "on disk only" and "in the database".
 */
export function usePlanWorktrees() {
  const plans = usePlanStore((s) => s.plans);
  const root = useProjectStore((s) => s.root);
  const [worktrees, setWorktrees] = useState<WorktreeInfo[]>([]);

  useEffect(() => {
    if (!root) { setWorktrees([]); return; }
    let cancelled = false;
    fetchWorktrees(root).then((w) => { if (!cancelled) setWorktrees(w); });
    return () => { cancelled = true; };
  }, [root, plans.length]);

  return useMemo(() => groupPlansByWorktree(plans, worktrees, root), [plans, worktrees, root]);
}
