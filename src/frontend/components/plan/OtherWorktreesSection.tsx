import { FolderOpen, GitBranch } from 'lucide-react';

import { usePlanStore } from '../../stores/plan-store';
import { usePlanWorktrees } from '../../hooks/usePlanWorktrees';
import { openWorktreeTab, worktreeLabel } from '../../lib/plan-worktrees';
import { StatusBadge } from './StatusBadge';

/**
 * Plans on this repo's OTHER worktrees, under the local list.
 *
 * The list above is scoped to the exact root that is open, so a plan an
 * agent wrote in a sibling worktree (another branch, often another agent)
 * never appeared. This lists them by branch: ones already in the app open
 * directly; ones only on that worktree's disk offer to open the worktree,
 * where the existing import flow picks them up.
 */
export function OtherWorktreesSection() {
  const { otherWorktrees } = usePlanWorktrees();
  const activePlanUid = usePlanStore((s) => s.activePlanUid);
  const setActivePlan = usePlanStore((s) => s.setActivePlan);

  const withPlans = otherWorktrees.filter((g) => g.plans.length > 0 || g.onDiskOnly.length > 0);
  if (withPlans.length === 0) return null;

  return (
    <div className="mt-3 pt-2 border-t border-white/[0.06] px-1.5" data-testid="other-worktrees">
      <div className="text-[11px] uppercase tracking-wider text-foreground-subtle mb-1.5">
        Other worktrees of this repo
      </div>
      {withPlans.map((g) => (
        <div key={g.worktree.path} className="mb-2">
          <div className="flex items-center gap-1.5 px-1 py-1 text-[11.5px] text-foreground-muted">
            <GitBranch size={11} className="shrink-0" />
            <span className="font-medium truncate" title={g.worktree.path}>{worktreeLabel(g.worktree)}</span>
            {g.worktree.isMain && <span className="text-[10px] text-foreground-subtle">main checkout</span>}
            <button
              onClick={() => void openWorktreeTab(g.worktree.path, g.worktree.branch)}
              className="ml-auto flex items-center gap-1 text-[10.5px] text-accent hover:underline shrink-0"
              title={`Open ${g.worktree.path} as a project tab`}
            >
              <FolderOpen size={10} /> Open worktree
            </button>
          </div>
          {g.plans.map((p) => (
            <button
              key={p.uid}
              onClick={() => void setActivePlan(p.uid)}
              className={`w-full flex items-center gap-2 pl-5 pr-2 py-1.5 rounded-md text-left transition-colors ${
                p.uid === activePlanUid ? 'bg-accent/10 text-accent' : 'text-foreground-muted hover:bg-surface-hover hover:text-foreground'
              }`}
            >
              <span className="flex-1 truncate text-[12.5px]">{p.title}</span>
              <StatusBadge status={p.status} />
            </button>
          ))}
          {g.onDiskOnly.map((p) => (
            <div
              key={p.uid}
              className="flex items-center gap-2 pl-5 pr-2 py-1.5 text-foreground-subtle"
              title="On that worktree's disk but not in the app yet. Open the worktree to import it."
            >
              <span className="flex-1 truncate text-[12.5px]">{p.title}</span>
              <span className="text-[10px]">on disk</span>
            </div>
          ))}
        </div>
      ))}
    </div>
  );
}
