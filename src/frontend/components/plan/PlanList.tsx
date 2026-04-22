import { useEffect } from 'react';
import { ClipboardList, Plus } from 'lucide-react';
import { usePlanStore } from '../../stores/plan-store';
import { useProjectStore } from '../../stores/project-store';
import { StatusBadge } from './StatusBadge';

export function PlanList({ onCreateClick }: { onCreateClick: () => void }) {
  const plans = usePlanStore((s) => s.plans);
  const activePlanUid = usePlanStore((s) => s.activePlanUid);
  const setActivePlan = usePlanStore((s) => s.setActivePlan);
  const fetchPlans = usePlanStore((s) => s.fetchPlans);
  const root = useProjectStore((s) => s.root);

  useEffect(() => {
    // Fetch all plans (filtered by project if one is open)
    fetchPlans(root || undefined);
  }, [root, fetchPlans]);

  return (
    <div className="space-y-1">
      <div className="flex items-center justify-between px-1 mb-2">
        <span className="text-[10px] text-foreground-subtle uppercase tracking-wider font-medium">
          Plans ({plans.length})
        </span>
        <button
          onClick={onCreateClick}
          className="flex items-center gap-1 text-[10px] text-accent hover:text-accent-hover transition-colors"
        >
          <Plus size={10} />
          New
        </button>
      </div>

      {plans.length === 0 && (
        <div className="flex flex-col items-center gap-2 py-6 text-foreground-subtle text-[11px]">
          <ClipboardList size={18} />
          <span>No plans yet</span>
          <button onClick={onCreateClick} className="text-accent hover:underline text-[10px]">Create one</button>
        </div>
      )}

      {plans.map((plan) => {
        const progress = plan.taskCount ? Math.round(((plan.completedTaskCount || 0) / plan.taskCount) * 100) : 0;
        return (
          <button
            key={plan.uid}
            onClick={() => setActivePlan(plan.uid)}
            className={`w-full text-left px-2.5 py-2 rounded-lg transition-all ${
              activePlanUid === plan.uid
                ? 'bg-accent/10 border border-accent/20'
                : 'hover:bg-surface-hover border border-transparent'
            }`}
          >
            <div className="flex items-center gap-2">
              <span className="text-[11px] font-medium text-foreground truncate flex-1">{plan.title}</span>
              <StatusBadge status={plan.status} />
            </div>
            {plan.taskCount != null && plan.taskCount > 0 && (
              <div className="mt-1.5 flex items-center gap-2">
                <div className="flex-1 h-1 rounded-full bg-white/[0.05] overflow-hidden">
                  <div className="h-full bg-accent/60 rounded-full transition-all" style={{ width: `${progress}%` }} />
                </div>
                <span className="text-[9px] text-foreground-subtle shrink-0">
                  {plan.completedTaskCount || 0}/{plan.taskCount}
                </span>
              </div>
            )}
          </button>
        );
      })}
    </div>
  );
}
