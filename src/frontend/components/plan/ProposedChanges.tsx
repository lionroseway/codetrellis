import { useEffect, useMemo, useState } from 'react';
import {
  FileCode,
  Code2,
  ArrowRight,
  Plus,
  Pencil,
  Minus,
  Move,
  CheckCircle2,
  AlertCircle,
  Loader2,
  Circle,
  RefreshCw,
} from 'lucide-react';
import { usePlanStore } from '../../stores/plan-store';
import type {
  ProposedChange,
  ChangeDriftStatus,
  ChangeKind,
  ChangeOperation,
} from '@shared/types';

/**
 * Proposed Changes — Phase 12 §B. The "did the plan land?" feed.
 *
 * Aggregates every affected file, symbol_spec, new_connection, and
 * removed_connection across all tasks into one CRUD row, then asks the
 * backend to compute drift status against the live database.
 *
 * Filters at the top: kind (file/symbol/connection), operation, drift
 * status. The same data is available to MCP agents via
 * `list_proposed_changes` so the agent and human see the same picture.
 */

const STATUS_META: Record<ChangeDriftStatus, { label: string; tint: string; Icon: typeof Circle }> = {
  planned: { label: 'Planned', tint: 'text-zinc-400', Icon: Circle },
  in_progress: { label: 'In progress', tint: 'text-accent', Icon: Loader2 },
  satisfied: { label: 'Satisfied', tint: 'text-green-400', Icon: CheckCircle2 },
  missing: { label: 'Missing', tint: 'text-amber-400', Icon: AlertCircle },
  unexpected: { label: 'Unexpected', tint: 'text-red-400', Icon: AlertCircle },
};

const OPERATION_ICON: Record<ChangeOperation, typeof Plus> = {
  add: Plus,
  modify: Pencil,
  remove: Minus,
  move: Move,
};

const KIND_ICON: Record<ChangeKind, typeof FileCode> = {
  file: FileCode,
  symbol: Code2,
  connection: ArrowRight,
};

export function ProposedChanges({ planUid }: { planUid: string }) {
  const setSelectedTask = usePlanStore((s) => s.setSelectedTask);

  const [changes, setChanges] = useState<ProposedChange[]>([]);
  const [loading, setLoading] = useState(true);
  const [tick, setTick] = useState(0);

  const [kindFilter, setKindFilter] = useState<ChangeKind | 'all'>('all');
  const [statusFilter, setStatusFilter] = useState<ChangeDriftStatus | 'all'>('all');

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    fetch(`/api/plans/${planUid}/changes`)
      .then((r) => r.json())
      .then((data: ProposedChange[]) => {
        if (cancelled) return;
        setChanges(Array.isArray(data) ? data : []);
        setLoading(false);
      })
      .catch(() => {
        if (cancelled) return;
        setChanges([]);
        setLoading(false);
      });
    return () => { cancelled = true; };
  }, [planUid, tick]);

  const summary = useMemo(() => {
    const counts: Record<ChangeDriftStatus, number> = {
      planned: 0, in_progress: 0, satisfied: 0, missing: 0, unexpected: 0,
    };
    for (const c of changes) counts[c.driftStatus]++;
    return counts;
  }, [changes]);

  const filtered = useMemo(() => {
    return changes.filter((c) => {
      if (kindFilter !== 'all' && c.kind !== kindFilter) return false;
      if (statusFilter !== 'all' && c.driftStatus !== statusFilter) return false;
      return true;
    });
  }, [changes, kindFilter, statusFilter]);

  // Group by task so the user can see "all changes from task X" together.
  const grouped = useMemo(() => {
    const map = new Map<string, ProposedChange[]>();
    for (const c of filtered) {
      const bucket = map.get(c.taskUid) ?? [];
      bucket.push(c);
      map.set(c.taskUid, bucket);
    }
    return [...map.entries()];
  }, [filtered]);

  if (loading && changes.length === 0) {
    return <div className="text-[11px] text-foreground-subtle py-4 text-center">Computing changes…</div>;
  }

  if (changes.length === 0) {
    return (
      <div className="text-[11px] text-foreground-subtle py-6 text-center leading-relaxed">
        No proposed changes yet. Tasks need <code className="bg-white/[0.05] px-1 rounded">affectedFiles</code>,{' '}
        <code className="bg-white/[0.05] px-1 rounded">symbolSpecs</code>, or connection edits to populate this view.
      </div>
    );
  }

  return (
    <div className="space-y-2">
      {/* Summary bar */}
      <div className="flex items-center gap-1.5 flex-wrap">
        <button
          onClick={() => setStatusFilter('all')}
          className={`text-[10px] px-1.5 py-0.5 rounded border ${
            statusFilter === 'all'
              ? 'border-accent/40 bg-accent/10 text-accent'
              : 'border-white/[0.06] text-foreground-muted hover:text-foreground'
          }`}
        >
          All <span className="opacity-70">{changes.length}</span>
        </button>
        {(Object.keys(STATUS_META) as ChangeDriftStatus[]).map((s) => {
          const meta = STATUS_META[s];
          const count = summary[s];
          if (count === 0) return null;
          return (
            <button
              key={s}
              onClick={() => setStatusFilter(s === statusFilter ? 'all' : s)}
              className={`flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded border ${
                statusFilter === s
                  ? `${meta.tint} border-current bg-white/[0.04]`
                  : 'border-white/[0.06] text-foreground-muted hover:text-foreground'
              }`}
            >
              <meta.Icon size={9} className={statusFilter === s ? '' : 'opacity-60'} />
              {meta.label} <span className="opacity-70">{count}</span>
            </button>
          );
        })}

        <span className="flex-1" />

        <select
          value={kindFilter}
          onChange={(e) => setKindFilter(e.target.value as ChangeKind | 'all')}
          className="text-[10px] bg-white/[0.04] border border-white/[0.08] rounded px-1.5 py-0.5 text-foreground-muted"
        >
          <option value="all">All kinds</option>
          <option value="file">Files</option>
          <option value="symbol">Symbols</option>
          <option value="connection">Connections</option>
        </select>
        <button
          onClick={() => setTick((n) => n + 1)}
          className="p-1 rounded text-foreground-subtle hover:text-foreground hover:bg-white/[0.05]"
          title="Re-compute drift status"
        >
          <RefreshCw size={11} />
        </button>
      </div>

      {/* Grouped list */}
      <div className="space-y-2">
        {grouped.map(([taskUid, taskChanges]) => {
          const first = taskChanges[0];
          return (
            <div key={taskUid} className="rounded-lg border border-white/[0.05] bg-white/[0.015] overflow-hidden">
              <button
                onClick={() => setSelectedTask(taskUid)}
                className="w-full px-2.5 py-1.5 text-left flex items-center gap-2 hover:bg-white/[0.03] transition-colors border-b border-white/[0.04]"
              >
                <span className="text-[11px] text-foreground font-medium truncate flex-1">
                  {first.taskDescription}
                </span>
                <span className={`text-[9px] uppercase tracking-wider px-1.5 py-0.5 rounded font-medium ${taskStatusTint(first.taskStatus)}`}>
                  {first.taskStatus}
                </span>
                <span className="text-[9px] text-foreground-subtle font-mono">
                  {taskChanges.length} change{taskChanges.length === 1 ? '' : 's'}
                </span>
              </button>
              <div className="divide-y divide-white/[0.03]">
                {taskChanges.map((c) => (
                  <ChangeRow key={c.id} change={c} />
                ))}
              </div>
            </div>
          );
        })}

        {filtered.length === 0 && (
          <div className="text-[11px] text-foreground-subtle py-4 text-center">
            No changes match the current filter.
          </div>
        )}
      </div>
    </div>
  );
}

function ChangeRow({ change }: { change: ProposedChange }) {
  const KIcon = KIND_ICON[change.kind];
  const OIcon = OPERATION_ICON[change.operation];
  const meta = STATUS_META[change.driftStatus];
  const isInProgress = change.driftStatus === 'in_progress';

  return (
    <div className="px-2.5 py-1.5 flex items-start gap-2 hover:bg-white/[0.02] transition-colors">
      <span className={`flex items-center gap-1 px-1 py-0.5 rounded bg-white/[0.04] ${operationTint(change.operation)} shrink-0 mt-px`}>
        <OIcon size={9} />
        <span className="text-[9px] uppercase tracking-wider font-mono">{change.operation}</span>
      </span>
      <KIcon size={11} className="text-foreground-subtle shrink-0 mt-0.5" />
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-1.5">
          <code className="text-[10.5px] font-mono text-foreground truncate">{change.target}</code>
        </div>
        {change.detail && (
          <div className="text-[9.5px] text-foreground-subtle font-mono truncate mt-0.5">
            {change.detail}
          </div>
        )}
      </div>
      <span className={`flex items-center gap-1 text-[9px] uppercase tracking-wider shrink-0 mt-0.5 ${meta.tint}`}>
        <meta.Icon size={9} className={isInProgress ? 'animate-spin' : ''} />
        {meta.label}
      </span>
    </div>
  );
}

function operationTint(op: ChangeOperation): string {
  switch (op) {
    case 'add': return 'text-green-400';
    case 'modify': return 'text-amber-400';
    case 'remove': return 'text-red-400';
    case 'move': return 'text-cyan-400';
  }
}

function taskStatusTint(status: string): string {
  switch (status) {
    case 'done': return 'text-green-400 bg-green-500/10';
    case 'in_progress': return 'text-accent bg-accent/10';
    case 'assigned': return 'text-blue-400 bg-blue-500/10';
    case 'blocked': return 'text-red-400 bg-red-500/10';
    case 'skipped': return 'text-zinc-400 bg-zinc-500/10';
    default: return 'text-zinc-400 bg-white/[0.04]';
  }
}
