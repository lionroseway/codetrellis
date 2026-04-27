import { useState } from 'react';
import { ChevronDown, ChevronRight, Plus, GitBranch, CheckCircle2, Circle, Loader2, Ban, Trash2, Pencil } from 'lucide-react';
import { usePlanStore } from '../../stores/plan-store';
import { Markdown } from '../../lib/markdown';
import type { PlanPhase, PhaseStatus, Task } from '@shared/types';

/**
 * Phases section — first-class checkpoints inside a plan, modelled on
 * the swf "01-PHASE-1-FOUNDATION / 02-PHASE-2-…" pattern. Plans without
 * phases keep working as a flat task list (PlanDetail handles that
 * fallback); this component is shown above the task list whenever the
 * plan has at least one phase.
 *
 * Each phase row is expandable: collapsed shows status + count + git
 * checkpoint chip, expanded shows scope / prereqs / acceptance criteria
 * (markdown-rendered) and the contained tasks with status icons.
 */
export function PlanPhases({ planUid, tasks }: { planUid: string; tasks: Task[] }) {
  const phases = usePlanStore((s) => s.planPhases);
  const createPlanPhase = usePlanStore((s) => s.createPlanPhase);

  const [showCreate, setShowCreate] = useState(false);
  const [editingUid, setEditingUid] = useState<string | null>(null);

  // Group tasks by phaseUid; keep an "Unphased" bucket for tasks that
  // never got bound to a phase (or whose phase was deleted).
  const tasksByPhase = new Map<string | null, Task[]>();
  for (const t of tasks) {
    const key = t.phaseUid ?? null;
    const bucket = tasksByPhase.get(key) ?? [];
    bucket.push(t);
    tasksByPhase.set(key, bucket);
  }

  if (phases.length === 0) {
    // Light plans show only the "Add phase" affordance — they keep using
    // the flat task list rendered by PlanDetail. Keep this very subtle.
    return (
      <div className="flex items-center justify-between text-[10px] text-foreground-subtle border border-dashed border-white/[0.06] rounded-md px-2 py-1.5">
        <span>No phases — flat task list</span>
        <button
          onClick={() => setShowCreate(true)}
          className="flex items-center gap-1 text-accent hover:text-accent-hover transition-colors"
        >
          <Plus size={10} /> Add first phase
        </button>
        {showCreate && (
          <PhaseModal
            planUid={planUid}
            onClose={() => setShowCreate(false)}
            onSave={async (input) => {
              await createPlanPhase(planUid, input);
              setShowCreate(false);
            }}
          />
        )}
      </div>
    );
  }

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <span className="text-[9px] text-foreground-subtle uppercase tracking-wider font-medium">
          Phases ({phases.length})
        </span>
        <button
          onClick={() => setShowCreate(true)}
          className="flex items-center gap-1 text-[10px] text-accent hover:text-accent-hover transition-colors"
        >
          <Plus size={10} /> Add phase
        </button>
      </div>

      <div className="space-y-1.5">
        {phases.map((phase) => (
          <PhaseRow
            key={phase.uid}
            phase={phase}
            tasks={tasksByPhase.get(phase.uid) ?? []}
            onEdit={() => setEditingUid(phase.uid)}
          />
        ))}
        {(tasksByPhase.get(null)?.length ?? 0) > 0 && (
          <UnphasedRow planUid={planUid} tasks={tasksByPhase.get(null) ?? []} phaseOptions={phases} />
        )}
      </div>

      {showCreate && (
        <PhaseModal
          planUid={planUid}
          onClose={() => setShowCreate(false)}
          onSave={async (input) => {
            await createPlanPhase(planUid, input);
            setShowCreate(false);
          }}
        />
      )}

      {editingUid && (
        <PhaseModal
          planUid={planUid}
          phase={phases.find((p) => p.uid === editingUid) ?? undefined}
          onClose={() => setEditingUid(null)}
          onSave={async (input) => {
            await usePlanStore.getState().updatePlanPhase(editingUid, input);
            setEditingUid(null);
          }}
          onDelete={async () => {
            await usePlanStore.getState().deletePlanPhase(editingUid);
            setEditingUid(null);
          }}
        />
      )}
    </div>
  );
}

const STATUS_META: Record<PhaseStatus, { Icon: typeof Circle; tint: string; label: string }> = {
  pending: { Icon: Circle, tint: 'text-zinc-500', label: 'Pending' },
  in_progress: { Icon: Loader2, tint: 'text-accent animate-spin', label: 'In progress' },
  done: { Icon: CheckCircle2, tint: 'text-green-400 drop-shadow-[0_0_3px_rgba(34,197,94,0.5)]', label: 'Done' },
  blocked: { Icon: Ban, tint: 'text-red-400', label: 'Blocked' },
};

function PhaseRow({
  phase,
  tasks,
  onEdit,
}: {
  phase: PlanPhase;
  tasks: Task[];
  onEdit: () => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const meta = STATUS_META[phase.status] ?? STATUS_META.pending;
  const completed = tasks.filter((t) => t.status === 'done').length;

  return (
    <div className={`rounded-lg border ${expanded ? 'border-accent/25 bg-white/[0.025]' : 'border-white/[0.06] bg-white/[0.015]'} transition-colors`}>
      <button
        onClick={() => setExpanded((v) => !v)}
        className="w-full flex items-center gap-2 px-2 py-1.5 text-left hover:bg-white/[0.02] rounded-lg"
      >
        {expanded ? <ChevronDown size={11} className="text-foreground-subtle shrink-0" /> : <ChevronRight size={11} className="text-foreground-subtle shrink-0" />}
        <span className="text-[10px] font-mono text-foreground-subtle bg-white/[0.06] px-1.5 rounded shrink-0">
          {String(phase.phaseNumber).padStart(2, '0')}
        </span>
        <meta.Icon size={11} className={`${meta.tint} shrink-0`} />
        <span className="text-[11.5px] font-medium text-foreground truncate flex-1">
          {phase.title}
        </span>
        {phase.gitCheckpoint && (
          <span className="hidden sm:flex items-center gap-1 text-[9px] text-foreground-subtle font-mono shrink-0" title={`Git checkpoint: ${phase.gitCheckpoint}`}>
            <GitBranch size={9} />
            {phase.gitCheckpoint.slice(0, 8)}
          </span>
        )}
        <span className="text-[9px] text-foreground-subtle shrink-0">
          {completed}/{tasks.length} tasks
        </span>
        <span
          onClick={(e) => { e.stopPropagation(); onEdit(); }}
          className="p-1 rounded hover:bg-white/[0.06] text-foreground-subtle hover:text-foreground transition-colors"
          title="Edit phase"
        >
          <Pencil size={10} />
        </span>
      </button>

      {expanded && (
        <div className="px-3 pb-3 pt-1 space-y-3 border-t border-white/[0.04]">
          {phase.scope.trim() && (
            <Section label="Scope"><Markdown source={phase.scope} /></Section>
          )}
          {phase.prerequisites.trim() && (
            <Section label="Prerequisites"><Markdown source={phase.prerequisites} /></Section>
          )}
          {phase.acceptanceCriteria.trim() && (
            <Section label="Acceptance criteria"><Markdown source={phase.acceptanceCriteria} /></Section>
          )}

          <div>
            <div className="text-[9px] text-foreground-subtle uppercase tracking-wider font-medium mb-1">
              Tasks ({tasks.length})
            </div>
            {tasks.length === 0 ? (
              <div className="text-[10px] text-foreground-subtle italic">
                No tasks bound to this phase yet. Drop tasks here from the Unphased bucket below.
              </div>
            ) : (
              <div className="space-y-0.5">
                {tasks.map((t) => (
                  <PhaseTaskRow key={t.uid} task={t} />
                ))}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function Section({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="text-[9px] text-foreground-subtle uppercase tracking-wider font-medium mb-1">
        {label}
      </div>
      <div className="rounded-md border border-white/[0.04] bg-black/20 px-3 py-2">
        {children}
      </div>
    </div>
  );
}

function PhaseTaskRow({ task }: { task: Task }) {
  const setSelectedTask = usePlanStore((s) => s.setSelectedTask);
  const selectedTaskUid = usePlanStore((s) => s.selectedTaskUid);
  const taskIcon = (() => {
    switch (task.status) {
      case 'done': return <CheckCircle2 size={11} className="text-green-400" />;
      case 'in_progress': return <Loader2 size={11} className="text-accent animate-spin" />;
      case 'blocked': return <Ban size={11} className="text-red-400" />;
      default: return <Circle size={11} className="text-zinc-500" />;
    }
  })();

  return (
    <button
      onClick={() => setSelectedTask(task.uid === selectedTaskUid ? null : task.uid)}
      className={`w-full flex items-start gap-2 px-2 py-1 rounded transition-colors text-left ${
        selectedTaskUid === task.uid ? 'bg-accent/10' : 'hover:bg-white/[0.03]'
      }`}
    >
      <span className="mt-0.5 shrink-0">{taskIcon}</span>
      <span className="text-[11px] text-foreground truncate">{task.description}</span>
    </button>
  );
}

function UnphasedRow({
  planUid,
  tasks,
  phaseOptions,
}: {
  planUid: string;
  tasks: Task[];
  phaseOptions: PlanPhase[];
}) {
  const [expanded, setExpanded] = useState(false);
  const assignTaskToPhase = usePlanStore((s) => s.assignTaskToPhase);
  return (
    <div className="rounded-lg border border-dashed border-white/[0.06] bg-white/[0.01]">
      <button
        onClick={() => setExpanded((v) => !v)}
        className="w-full flex items-center gap-2 px-2 py-1.5 text-left hover:bg-white/[0.02] rounded-lg"
      >
        {expanded ? <ChevronDown size={11} className="text-foreground-subtle shrink-0" /> : <ChevronRight size={11} className="text-foreground-subtle shrink-0" />}
        <span className="text-[10px] uppercase tracking-wider text-foreground-subtle font-medium flex-1">
          Unphased
        </span>
        <span className="text-[9px] text-foreground-subtle">
          {tasks.length} task{tasks.length === 1 ? '' : 's'}
        </span>
      </button>
      {expanded && (
        <div className="px-3 pb-2 pt-1 space-y-1 border-t border-white/[0.04]">
          {tasks.map((t) => (
            <div key={t.uid} className="flex items-center gap-2 px-1 py-0.5">
              <PhaseTaskRow task={t} />
              <select
                value=""
                onChange={(e) => {
                  const v = e.target.value;
                  if (v) assignTaskToPhase(planUid, t.uid, v);
                }}
                className="text-[10px] bg-white/[0.04] border border-white/[0.08] rounded px-1.5 py-0.5 text-foreground-muted shrink-0"
                title="Assign to phase"
              >
                <option value="">→ phase…</option>
                {phaseOptions.map((p) => (
                  <option key={p.uid} value={p.uid}>
                    {String(p.phaseNumber).padStart(2, '0')} {p.title}
                  </option>
                ))}
              </select>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// --- Phase create/edit modal ---

import { createPortal } from 'react-dom';
import { X } from 'lucide-react';

interface PhaseFormInput {
  title: string;
  phaseNumber?: number;
  scope: string;
  prerequisites: string;
  gitCheckpoint: string | null;
  acceptanceCriteria: string;
  status: PhaseStatus;
}

function PhaseModal({
  planUid: _planUid,
  phase,
  onClose,
  onSave,
  onDelete,
}: {
  planUid: string;
  phase?: PlanPhase;
  onClose: () => void;
  onSave: (input: PhaseFormInput) => Promise<void> | void;
  onDelete?: () => Promise<void> | void;
}) {
  const isEdit = !!phase;
  const [title, setTitle] = useState(phase?.title ?? '');
  const [phaseNumberStr, setPhaseNumberStr] = useState(phase?.phaseNumber?.toString() ?? '');
  const [scope, setScope] = useState(phase?.scope ?? '');
  const [prerequisites, setPrerequisites] = useState(phase?.prerequisites ?? '');
  const [gitCheckpoint, setGitCheckpoint] = useState(phase?.gitCheckpoint ?? '');
  const [acceptanceCriteria, setAcceptanceCriteria] = useState(
    phase?.acceptanceCriteria ?? '- [ ] \n- [ ] \n',
  );
  const [status, setStatus] = useState<PhaseStatus>(phase?.status ?? 'pending');
  const [saving, setSaving] = useState(false);

  const handleSave = async () => {
    if (!title.trim()) return;
    setSaving(true);
    const phaseNumber = phaseNumberStr.trim() ? parseInt(phaseNumberStr, 10) : undefined;
    await onSave({
      title: title.trim(),
      phaseNumber: Number.isFinite(phaseNumber as number) ? phaseNumber : undefined,
      scope,
      prerequisites,
      gitCheckpoint: gitCheckpoint.trim() ? gitCheckpoint.trim() : null,
      acceptanceCriteria,
      status,
    });
    setSaving(false);
  };

  return createPortal(
    <div className="fixed inset-0 z-50 flex items-center justify-center p-6 bg-black/70 backdrop-blur-sm" onClick={onClose}>
      <div
        className="w-full max-w-2xl max-h-[90vh] flex flex-col rounded-2xl border border-white/[0.08] bg-[#0b1020] shadow-[0_24px_80px_rgba(0,0,0,0.6)]"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-5 py-4 border-b border-white/[0.06]">
          <h3 className="text-[13px] font-semibold text-foreground">
            {isEdit ? `Edit phase ${String(phase!.phaseNumber).padStart(2, '0')}` : 'New phase'}
          </h3>
          <button onClick={onClose} className="p-1.5 rounded-md text-foreground-subtle hover:text-foreground hover:bg-white/[0.05]">
            <X size={14} />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-5 py-4 space-y-3">
          <div className="grid grid-cols-[80px_1fr_140px] gap-3">
            <div>
              <label className="block text-[10px] uppercase tracking-wider text-foreground-subtle mb-1">Number</label>
              <input
                type="text"
                value={phaseNumberStr}
                onChange={(e) => setPhaseNumberStr(e.target.value)}
                placeholder="auto"
                className="w-full bg-white/[0.02] border border-white/[0.08] rounded-md px-3 py-1.5 text-[12px] font-mono text-foreground focus:outline-none focus:border-accent/40"
              />
            </div>
            <div>
              <label className="block text-[10px] uppercase tracking-wider text-foreground-subtle mb-1">Title</label>
              <input
                autoFocus
                type="text"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="Foundation, Migration, Cutover, …"
                className="w-full bg-white/[0.02] border border-white/[0.08] rounded-md px-3 py-1.5 text-[12.5px] text-foreground focus:outline-none focus:border-accent/40"
              />
            </div>
            <div>
              <label className="block text-[10px] uppercase tracking-wider text-foreground-subtle mb-1">Status</label>
              <select
                value={status}
                onChange={(e) => setStatus(e.target.value as PhaseStatus)}
                className="w-full bg-white/[0.02] border border-white/[0.08] rounded-md px-3 py-1.5 text-[12px] text-foreground focus:outline-none focus:border-accent/40"
              >
                <option value="pending">Pending</option>
                <option value="in_progress">In progress</option>
                <option value="done">Done</option>
                <option value="blocked">Blocked</option>
              </select>
            </div>
          </div>

          <div>
            <label className="block text-[10px] uppercase tracking-wider text-foreground-subtle mb-1">Git checkpoint</label>
            <input
              type="text"
              value={gitCheckpoint}
              onChange={(e) => setGitCheckpoint(e.target.value)}
              placeholder='Commit hash, tag, or label (e.g. "v1.4-foundation-complete")'
              className="w-full bg-white/[0.02] border border-white/[0.08] rounded-md px-3 py-1.5 text-[12px] font-mono text-foreground focus:outline-none focus:border-accent/40"
            />
          </div>

          <div>
            <label className="block text-[10px] uppercase tracking-wider text-foreground-subtle mb-1">Scope (markdown)</label>
            <textarea
              value={scope}
              onChange={(e) => setScope(e.target.value)}
              placeholder="What this phase covers. Backend models, routes, frontend types, etc."
              className="w-full min-h-[100px] bg-black/30 border border-white/[0.06] rounded-md px-3 py-2 text-[12px] font-mono text-foreground placeholder:text-foreground-subtle focus:outline-none focus:border-accent/30 resize-none leading-relaxed"
            />
          </div>

          <div>
            <label className="block text-[10px] uppercase tracking-wider text-foreground-subtle mb-1">Prerequisites (markdown)</label>
            <textarea
              value={prerequisites}
              onChange={(e) => setPrerequisites(e.target.value)}
              placeholder="What must be done before this phase starts."
              className="w-full min-h-[80px] bg-black/30 border border-white/[0.06] rounded-md px-3 py-2 text-[12px] font-mono text-foreground placeholder:text-foreground-subtle focus:outline-none focus:border-accent/30 resize-none leading-relaxed"
            />
          </div>

          <div>
            <label className="block text-[10px] uppercase tracking-wider text-foreground-subtle mb-1">Acceptance criteria (markdown)</label>
            <textarea
              value={acceptanceCriteria}
              onChange={(e) => setAcceptanceCriteria(e.target.value)}
              placeholder="- [ ] All routes return 200&#10;- [ ] Frontend types compile&#10;- [ ] Drift report clean"
              className="w-full min-h-[100px] bg-black/30 border border-white/[0.06] rounded-md px-3 py-2 text-[12px] font-mono text-foreground placeholder:text-foreground-subtle focus:outline-none focus:border-accent/30 resize-none leading-relaxed"
            />
          </div>
        </div>

        <div className="flex items-center justify-between gap-2 px-5 py-3 border-t border-white/[0.06]">
          {isEdit && onDelete ? (
            <button
              onClick={async () => {
                if (confirm(`Delete phase "${phase!.title}"? Tasks bound to it will become unphased.`)) {
                  await onDelete();
                }
              }}
              className="flex items-center gap-1.5 px-3 py-1.5 text-[11px] rounded-md text-red-300 hover:text-red-200 hover:bg-red-500/10"
            >
              <Trash2 size={11} /> Delete
            </button>
          ) : (
            <span />
          )}
          <div className="flex items-center gap-2">
            <button
              onClick={onClose}
              className="px-3 py-1.5 text-[11px] rounded-md text-foreground-muted hover:text-foreground hover:bg-white/[0.04]"
            >
              Cancel
            </button>
            <button
              onClick={handleSave}
              disabled={saving || !title.trim()}
              className="px-3 py-1.5 text-[11px] rounded-md bg-accent text-white hover:bg-accent-hover disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            >
              {saving ? 'Saving…' : isEdit ? 'Save changes' : 'Create phase'}
            </button>
          </div>
        </div>
      </div>
    </div>,
    document.body,
  );
}
