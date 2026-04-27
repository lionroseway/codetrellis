import { useEffect, useState } from 'react';
import { FileCode, ChevronLeft, CheckCircle2, Circle, Loader2, Ban, SkipForward, User, Download, Link2, Link2Off, Layers } from 'lucide-react';
import { usePlanStore } from '../../stores/plan-store';
import { useProjectStore } from '../../stores/project-store';
import { useToastStore } from '../../stores/toast-store';
import { StatusBadge } from './StatusBadge';
import { SpecRoom } from './SpecRoom';
import { PlanPhases } from './PlanPhases';
import { VerificationPanel } from './VerificationPanel';
import { PublishTemplateModal } from './PublishTemplateModal';

export function PlanDetail() {
  const plan = usePlanStore((s) => s.activePlan);
  const phases = usePlanStore((s) => s.planPhases);
  const setActivePlan = usePlanStore((s) => s.setActivePlan);
  const selectedTaskUid = usePlanStore((s) => s.selectedTaskUid);
  const setSelectedTask = usePlanStore((s) => s.setSelectedTask);
  const projectRoot = useProjectStore((s) => s.root);
  const addToast = useToastStore((s) => s.addToast);
  const [exporting, setExporting] = useState(false);
  const [linked, setLinked] = useState<boolean | null>(null);
  const [publishOpen, setPublishOpen] = useState(false);

  // Phase 13 §B: a plan is "linked" when its directory exists on disk;
  // every mutation auto-syncs through `plan-file-service.scheduleWriteThrough`.
  // Refresh on plan switch + when a `plan-exported` / `plan-unlinked` WS
  // event names this plan.
  useEffect(() => {
    if (!plan || !projectRoot) { setLinked(null); return; }
    let cancelled = false;
    fetch(`/api/plans/${plan.uid}/file-status?path=${encodeURIComponent(projectRoot)}`)
      .then((r) => r.json())
      .then((data) => { if (!cancelled) setLinked(!!data.linked); })
      .catch(() => { if (!cancelled) setLinked(null); });
    return () => { cancelled = true; };
  }, [plan?.uid, projectRoot]);

  if (!plan) return null;

  const progress = plan.taskCount ? Math.round(((plan.completedTaskCount || 0) / (plan.taskCount || 1)) * 100) : 0;

  const handleExport = async () => {
    if (!projectRoot) {
      addToast({ type: 'warning', title: 'Open a project first', message: 'Plans export to <project>/.codetrellis/plans/' });
      return;
    }
    setExporting(true);
    try {
      const res = await fetch(`/api/plans/${plan.uid}/export?path=${encodeURIComponent(projectRoot)}`, { method: 'POST' });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error || 'Export failed');
      setLinked(true);
      addToast({
        type: 'success',
        title: 'Plan linked to disk',
        message: `Wrote ${data.files.length} files. Future edits auto-sync.`,
        duration: 6000,
      });
    } catch (err) {
      addToast({ type: 'error', title: 'Export failed', message: String(err) });
    } finally {
      setExporting(false);
    }
  };

  const handleUnlink = async () => {
    if (!projectRoot || !plan) return;
    if (!confirm(`Stop syncing "${plan.title}" to .codetrellis/plans/?\n\nThe directory on disk will be deleted. Your DB rows stay intact. You can always re-export later.`)) return;
    try {
      const res = await fetch(`/api/plans/${plan.uid}/unlink?path=${encodeURIComponent(projectRoot)}`, { method: 'POST' });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || 'Unlink failed');
      }
      setLinked(false);
      addToast({ type: 'info', title: 'Plan unlinked', message: 'Directory removed; DB intact.' });
    } catch (err) {
      addToast({ type: 'error', title: 'Unlink failed', message: String(err) });
    }
  };

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
          {linked === true ? (
            <button
              onClick={handleUnlink}
              disabled={!projectRoot}
              className="flex items-center gap-1 px-2 py-1 text-[10px] rounded-md border border-emerald-500/30 bg-emerald-500/[0.08] text-emerald-300 hover:bg-emerald-500/[0.15] hover:border-emerald-500/50 transition-colors group"
              title="Linked: every change auto-syncs to .codetrellis/plans/. Click to unlink."
            >
              <Link2 size={10} className="group-hover:hidden" />
              <Link2Off size={10} className="hidden group-hover:inline" />
              <span className="group-hover:hidden">Linked</span>
              <span className="hidden group-hover:inline">Unlink</span>
            </button>
          ) : (
            <button
              onClick={handleExport}
              disabled={exporting || !projectRoot}
              className="flex items-center gap-1 px-2 py-1 text-[10px] rounded-md border border-white/[0.06] text-foreground-muted hover:text-foreground hover:bg-white/[0.04] disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
              title={projectRoot ? `Link this plan to ${projectRoot}/.codetrellis/plans/ for git-based sync` : 'Open a project first'}
            >
              <Download size={10} />
              {exporting ? 'Linking…' : 'Link to disk'}
            </button>
          )}
          <button
            onClick={() => setPublishOpen(true)}
            disabled={!projectRoot}
            className="flex items-center gap-1 px-2 py-1 text-[10px] rounded-md border border-white/[0.06] text-foreground-muted hover:text-foreground hover:bg-white/[0.04] disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            title={projectRoot ? 'Snapshot this plan as a reusable template' : 'Open a project first'}
          >
            <Layers size={10} />
            Publish as template
          </button>
        </div>

        {publishOpen && projectRoot && (
          <PublishTemplateModal
            planUid={plan.uid}
            planTitle={plan.title}
            projectRoot={projectRoot}
            onClose={() => setPublishOpen(false)}
            onPublished={() => { /* WS event handles list refresh */ }}
          />
        )}
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
