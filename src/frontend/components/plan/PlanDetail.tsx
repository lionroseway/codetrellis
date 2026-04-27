import { FileCode, ChevronLeft, CheckCircle2, Circle, Loader2, Ban, SkipForward, User } from 'lucide-react';
import { usePlanStore } from '../../stores/plan-store';
import { StatusBadge } from './StatusBadge';
import { SpecRoom } from './SpecRoom';
import { PlanPhases } from './PlanPhases';
import { VerificationPanel } from './VerificationPanel';

export function PlanDetail() {
  const plan = usePlanStore((s) => s.activePlan);
  const phases = usePlanStore((s) => s.planPhases);
  const setActivePlan = usePlanStore((s) => s.setActivePlan);
  const selectedTaskUid = usePlanStore((s) => s.selectedTaskUid);
  const setSelectedTask = usePlanStore((s) => s.setSelectedTask);

  if (!plan) return null;

  const progress = plan.taskCount ? Math.round(((plan.completedTaskCount || 0) / (plan.taskCount || 1)) * 100) : 0;

  const taskIcon = (status: string) => {
    switch (status) {
      case 'done': return <CheckCircle2 size={12} className="text-green-400 drop-shadow-[0_0_3px_rgba(34,197,94,0.5)]" />;
      case 'in_progress': return <Loader2 size={12} className="text-accent animate-spin" />;
      case 'assigned': return <User size={12} className="text-blue-400" />;
      case 'blocked': return <Ban size={12} className="text-red-400" />;
      case 'skipped': return <SkipForward size={12} className="text-zinc-500" />;
      default: return <Circle size={12} className="text-zinc-500" />;
    }
  };

  return (
    <div className="space-y-3">
      {/* Header */}
      <div>
        <button
          onClick={() => setActivePlan(null)}
          className="flex items-center gap-1 text-[10px] text-foreground-subtle hover:text-foreground transition-colors mb-1"
        >
          <ChevronLeft size={10} />
          All Plans
        </button>
        <div className="flex items-center gap-2">
          <h3 className="text-xs font-semibold text-foreground flex-1">{plan.title}</h3>
          <StatusBadge status={plan.status} />
        </div>
        {plan.description && (
          <p className="text-[10px] text-foreground-muted mt-1 leading-relaxed">{plan.description}</p>
        )}
      </div>

      {/* Progress */}
      <div className="flex items-center gap-2">
        <div className="flex-1 h-1.5 rounded-full bg-white/[0.05] overflow-hidden">
          <div
            className="h-full bg-accent/60 rounded-full transition-all"
            style={{ width: `${progress}%` }}
          />
        </div>
        <span className="text-[10px] text-foreground-subtle">{progress}%</span>
      </div>

      {/* "Are we done?" verification — Phase 12 §B + auto-progress; closes
          step 11 of the front-to-back loop. Hidden when the plan has no
          proposed changes (no affected files / symbols / connections). */}
      <VerificationPanel planUid={plan.uid} />

      {/* Spec Room — structured context docs (patterns, security, tests, etc.) */}
      <SpecRoom planUid={plan.uid} />

      {/* Phases — first-class checkpoints (swf-style); falls back to a
          subtle "no phases" hint that lets the user add one without
          changing the look of light plans. */}
      <PlanPhases planUid={plan.uid} tasks={plan.tasks} />

      {/* Flat task list — only when the plan has zero phases. With
          phases, all tasks render inside PlanPhases (phased + unphased
          buckets) and the duplicate flat list would be noise. */}
      {phases.length === 0 && (
        <div>
          <span className="text-[9px] text-foreground-subtle uppercase tracking-wider font-medium">
            Tasks ({plan.tasks.length})
          </span>
          <div className="mt-1 space-y-0.5">
            {plan.tasks.map((task) => (
              <button
                key={task.uid}
                onClick={() => setSelectedTask(task.uid === selectedTaskUid ? null : task.uid)}
                className={`w-full text-left flex items-start gap-2 px-2 py-1.5 rounded-md transition-all ${
                  selectedTaskUid === task.uid
                    ? 'bg-accent/10 border border-accent/20'
                    : 'hover:bg-surface-hover border border-transparent'
                }`}
              >
                <span className="mt-0.5 shrink-0">{taskIcon(task.status)}</span>
                <div className="flex-1 min-w-0">
                  <span className="text-[11px] text-foreground block truncate">{task.description}</span>
                  {task.affectedFiles.length > 0 && (
                    <div className="flex items-center gap-1 mt-0.5">
                      <FileCode size={9} className="text-foreground-subtle" />
                      <span className="text-[9px] text-foreground-subtle truncate">
                        {task.affectedFiles.length} file{task.affectedFiles.length > 1 ? 's' : ''}
                      </span>
                    </div>
                  )}
                  {task.assignee && (
                    <span className="text-[9px] text-accent mt-0.5 block">{task.assigneeType}: {task.assignee}</span>
                  )}
                </div>
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Meta */}
      <div className="text-[9px] text-foreground-subtle space-y-0.5 pt-1 border-t border-white/[0.04]">
        <div>Author: {plan.author} ({plan.authorType})</div>
        <div>Created: {new Date(plan.createdAt).toLocaleString()}</div>
      </div>
    </div>
  );
}
