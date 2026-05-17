import { useEffect, useState } from 'react';
import { Maximize2, ListChecks, X } from 'lucide-react';
import { usePlanStore } from '../../stores/plan-store';

/**
 * Phase 14 §B — minimized-plan chip.
 *
 * Floats bottom-right whenever a plan is selected but the workspace
 * has been minimized (graph mode + activePlanUid). Click the body to
 * restore the takeover; click ✕ to fully close the plan (clearing
 * `activePlanUid`).
 *
 * Slides in from below on mount so it doesn't pop in jarringly.
 * The takeover overlay handles its own enter/exit animation.
 */
export function MinimizedPlanChip({ onRestore }: { onRestore: () => void }) {
  const plan = usePlanStore((s) => s.activePlan);
  const setActivePlan = usePlanStore((s) => s.setActivePlan);

  const [shown, setShown] = useState(false);
  useEffect(() => {
    // Defer one frame so the transition fires from the off → on
    // state on first paint. Without this, mounting straight into
    // `shown=true` skips the animation.
    const t = requestAnimationFrame(() => setShown(true));
    return () => cancelAnimationFrame(t);
  }, []);

  if (!plan) return null;

  const completed = plan.completedTaskCount ?? 0;
  const total = plan.taskCount ?? 0;
  const pct = total ? Math.round((completed / total) * 100) : 0;

  return (
    <div
      className={`absolute bottom-3 right-3 z-20 flex items-center gap-2 rounded-full border border-accent/40 bg-[#0c0e1a]/95 backdrop-blur-md shadow-[0_8px_32px_rgba(0,0,0,0.6)] px-3 py-1.5 text-[11px] transition-all duration-300 ease-out ${
        shown ? 'translate-y-0 opacity-100' : 'translate-y-3 opacity-0'
      }`}
      style={{ pointerEvents: shown ? 'auto' : 'none' }}
    >
      <button
        onClick={onRestore}
        className="flex items-center gap-2 text-foreground hover:text-accent transition-colors"
        title="Restore plan workspace (click anywhere on the chip body)"
      >
        <ListChecks size={12} className="text-accent" />
        <span className="font-medium max-w-[200px] truncate">{plan.title}</span>
        <span className="text-[10px] text-foreground-subtle">
          {completed}/{total} · {pct}%
        </span>
        <Maximize2 size={11} className="text-foreground-subtle" />
      </button>
      <button
        onClick={() => setActivePlan(null)}
        className="text-foreground-subtle hover:text-red-300 transition-colors p-0.5 rounded hover:bg-white/[0.05]"
        title="Close plan"
      >
        <X size={11} />
      </button>
    </div>
  );
}
