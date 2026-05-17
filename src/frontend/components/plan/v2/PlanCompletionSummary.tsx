/**
 * Phase 17.M — Completion Summary & Retrospective.
 *
 * Shown on the plan home page when all actions are done (or the plan
 * is in "completed" status). Displays:
 *   - Completion stats (tasks done, time span, files touched)
 *   - Before/after diff summary (plan vs actual)
 *   - Per-task outcome (done / skipped / drifted)
 *   - Option to save the completed plan as a template for next time
 *
 * This is a read-only "retrospective" view — no editing, just insight.
 */

import { useCallback, useMemo, useState } from 'react';
import {
  Trophy,
  Clock,
  FileCode,
  CheckCircle2,
  SkipForward,
  AlertTriangle,
  Save,
  ChevronDown,
  ChevronUp,
  Sparkles,
} from 'lucide-react';
import { usePlanStore } from '../../../stores/plan-store';
import { usePlanItemsStore } from '../../../stores/plan-items-store';
import { useToastStore } from '../../../stores/toast-store';
import type { Plan, PlanItem } from '@shared/types';

function formatDuration(ms: number): string {
  const hours = Math.floor(ms / (1000 * 60 * 60));
  const days = Math.floor(hours / 24);
  if (days > 0) return `${days}d ${hours % 24}h`;
  if (hours > 0) return `${hours}h`;
  const mins = Math.floor(ms / (1000 * 60));
  return `${mins}m`;
}

export function PlanCompletionSummary() {
  const plan = usePlanStore((s) => s.activePlan);
  const itemsByUid = usePlanItemsStore((s) => s.itemsByUid);
  const addToast = useToastStore((s) => s.addToast);
  const [expanded, setExpanded] = useState(true);
  const [saving, setSaving] = useState(false);

  const items = useMemo(() => Object.values(itemsByUid), [itemsByUid]);
  const actions = useMemo(() => items.filter((i) => i.kind === 'action'), [items]);

  const stats = useMemo(() => {
    if (!plan || actions.length === 0) return null;

    const done = actions.filter((a) => a.status === 'done');
    const skipped = actions.filter((a) => a.status === 'skipped');
    const blocked = actions.filter((a) => a.status === 'blocked');

    // Time span
    const earliest = Math.min(...actions.map((a) => a.createdAt));
    const latest = Math.max(...actions.map((a) => a.updatedAt));
    const duration = latest - earliest;

    // Files touched
    const allFiles = new Set<string>();
    for (const a of actions) {
      for (const fs of a.fileSpecs ?? []) {
        allFiles.add(fs.path);
      }
    }

    // Completion rate
    const completionRate = actions.length > 0
      ? Math.round((done.length / actions.length) * 100)
      : 0;

    return {
      total: actions.length,
      done: done.length,
      skipped: skipped.length,
      blocked: blocked.length,
      inProgress: actions.filter((a) => a.status === 'in_progress').length,
      pending: actions.filter((a) => a.status === 'pending').length,
      duration,
      filesCount: allFiles.size,
      completionRate,
    };
  }, [plan, actions]);

  // Only show when plan is complete or all actions are done/skipped
  const isComplete = useMemo(() => {
    if (!plan) return false;
    if (plan.status === 'completed') return true;
    if (actions.length === 0) return false;
    return actions.every((a) => a.status === 'done' || a.status === 'skipped');
  }, [plan, actions]);

  const handleSaveAsTemplate = useCallback(async () => {
    if (!plan) return;
    setSaving(true);
    try {
      const res = await fetch(`/api/plans/${plan.uid}/publish-as-template`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      });
      if (!res.ok) throw new Error(await res.text());
      addToast({
        type: 'success',
        title: 'Saved as template',
        message: 'This plan is now available as a reusable template.',
      });
    } catch (err) {
      addToast({
        type: 'error',
        title: 'Failed to save template',
        message: String(err instanceof Error ? err.message : err),
      });
    } finally {
      setSaving(false);
    }
  }, [plan, addToast]);

  if (!isComplete || !stats) return null;

  return (
    <div className="rounded-xl border border-green-500/20 bg-green-500/[0.03] overflow-hidden">
      {/* Header */}
      <button
        onClick={() => setExpanded((p) => !p)}
        className="w-full flex items-center gap-3 px-5 py-4 text-left"
      >
        <div className="w-8 h-8 rounded-lg bg-green-500/10 flex items-center justify-center">
          <Trophy size={16} className="text-green-400" />
        </div>
        <div className="flex-1">
          <div className="text-[14px] font-semibold text-green-300">Plan Complete</div>
          <div className="text-[12px] text-green-400/60">
            {stats.done}/{stats.total} tasks done
            {stats.skipped > 0 ? ` · ${stats.skipped} skipped` : ''}
            {stats.duration > 0 ? ` · ${formatDuration(stats.duration)}` : ''}
          </div>
        </div>
        <div className="text-[24px] font-bold text-green-400 tabular-nums mr-2">
          {stats.completionRate}%
        </div>
        {expanded ? <ChevronUp size={14} className="text-green-400/50" /> : <ChevronDown size={14} className="text-green-400/50" />}
      </button>

      {expanded && (
        <div className="px-5 pb-5 space-y-4 border-t border-green-500/10 pt-4">
          {/* Stats grid */}
          <div className="grid grid-cols-4 gap-3">
            <StatCard
              icon={<CheckCircle2 size={14} className="text-green-400" />}
              label="Completed"
              value={stats.done}
            />
            <StatCard
              icon={<SkipForward size={14} className="text-zinc-400" />}
              label="Skipped"
              value={stats.skipped}
            />
            <StatCard
              icon={<FileCode size={14} className="text-blue-400" />}
              label="Files"
              value={stats.filesCount}
            />
            <StatCard
              icon={<Clock size={14} className="text-amber-400" />}
              label="Duration"
              value={formatDuration(stats.duration)}
              isString
            />
          </div>

          {/* Task breakdown */}
          <div className="space-y-1">
            <div className="text-[11px] text-foreground-muted uppercase tracking-wider font-medium mb-2">
              Task outcomes
            </div>
            {actions.map((action) => (
              <TaskOutcomeRow key={action.uid} action={action} />
            ))}
          </div>

          {/* Warnings */}
          {stats.blocked > 0 && (
            <div className="flex items-center gap-2 px-3 py-2 rounded-md bg-red-500/[0.06] border border-red-500/20 text-[12px] text-red-300">
              <AlertTriangle size={12} />
              {stats.blocked} task{stats.blocked !== 1 ? 's' : ''} ended in blocked state
            </div>
          )}

          {/* Actions */}
          <div className="flex items-center gap-3 pt-2">
            <button
              onClick={handleSaveAsTemplate}
              disabled={saving}
              className="flex items-center gap-2 px-3.5 py-2 text-[12px] rounded-md border border-white/[0.08] text-foreground-muted hover:text-foreground hover:bg-white/[0.04] transition-colors disabled:opacity-50"
            >
              <Save size={12} />
              {saving ? 'Saving...' : 'Save as template'}
            </button>
            <span className="text-[11px] text-foreground-subtle">
              Reuse this plan structure for similar work in the future
            </span>
          </div>
        </div>
      )}
    </div>
  );
}

function StatCard({ icon, label, value, isString }: { icon: React.ReactNode; label: string; value: number | string; isString?: boolean }) {
  return (
    <div className="flex items-center gap-2 px-3 py-2 rounded-lg border border-white/[0.05] bg-white/[0.02]">
      {icon}
      <div className="flex-1 min-w-0">
        <div className={`${isString ? 'text-[12px]' : 'text-[15px]'} font-semibold text-foreground tabular-nums`}>
          {value}
        </div>
        <div className="text-[10px] text-foreground-subtle uppercase tracking-wider">{label}</div>
      </div>
    </div>
  );
}

function TaskOutcomeRow({ action }: { action: PlanItem }) {
  const statusMeta: Record<string, { icon: typeof CheckCircle2; tint: string }> = {
    done: { icon: CheckCircle2, tint: 'text-green-400' },
    skipped: { icon: SkipForward, tint: 'text-zinc-400' },
    blocked: { icon: AlertTriangle, tint: 'text-red-400' },
    in_progress: { icon: Sparkles, tint: 'text-accent' },
    pending: { icon: Clock, tint: 'text-zinc-500' },
  };

  const meta = statusMeta[action.status ?? 'pending'] ?? statusMeta.pending;
  const Icon = meta.icon;

  return (
    <div className="flex items-center gap-2 px-2 py-1 rounded-md hover:bg-white/[0.02]">
      <Icon size={11} className={`${meta.tint} shrink-0`} />
      <span className="text-[12px] text-foreground-muted truncate flex-1">
        {action.title}
      </span>
      <span className="text-[10px] text-foreground-subtle uppercase tracking-wider">
        {action.status}
      </span>
    </div>
  );
}
