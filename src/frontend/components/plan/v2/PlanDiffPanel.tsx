import { useEffect, useMemo, useState } from 'react';
import {
  GitCompare, FileText, Hash, ArrowRight, RefreshCw, ChevronRight,
  Plus, Pencil, Trash, Move, CircleSlash, CheckCircle2, AlertTriangle, Loader2, Eye,
} from 'lucide-react';
import { usePlanItemsStore } from '../../../stores/plan-items-store';
import { useProjectStore } from '../../../stores/project-store';
import { openFileAt, absoluteFilePath } from '../../../lib/open-file-at';
import type {
  ProposedChange, ChangeDriftStatus, ChangeKind, ChangeOperation,
} from '@shared/types';

/**
 * Phase 15 §15.D — Plan Diff Panel.
 *
 * Reads `/api/plans/:uid/changes` (the projection over Actions'
 * fileSpecs / symbolSpecs / connections) and renders the result as a
 * grouped, filterable list. Click a row → navigates to the owning
 * Action so the user can edit the intent.
 *
 * Why a panel and not a separate route: a plan is a page, the diff
 * is a feature of that page. Keeping it inline means the user can
 * scan "what's planned vs what landed" without losing the body
 * context that explains why the plan exists.
 *
 * The drift detector lives server-side (plan-changes-service); we
 * just hydrate + render here. Refresh button re-fetches because
 * graph state can shift independently of plan state (a scan completes,
 * an agent commits a file).
 */
export function PlanDiffPanel({ planUid }: { planUid: string }) {
  const selectItem = usePlanItemsStore((s) => s.selectItem);
  const root = useProjectStore((s) => s.root);
  const [changes, setChanges] = useState<ProposedChange[] | null>(null);
  const [filter, setFilter] = useState<ChangeDriftStatus | 'all'>('all');
  const [collapsed, setCollapsed] = useState(false);
  const [loading, setLoading] = useState(false);

  const fetchChanges = async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/plans/${planUid}/changes`);
      const data = (await res.json()) as ProposedChange[];
      setChanges(Array.isArray(data) ? data : []);
    } catch {
      setChanges([]);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { fetchChanges(); }, [planUid]); // eslint-disable-line react-hooks/exhaustive-deps

  const counts = useMemo(() => {
    const c: Record<ChangeDriftStatus | 'all', number> = {
      all: 0, planned: 0, in_progress: 0, satisfied: 0, missing: 0, unexpected: 0,
    };
    if (!changes) return c;
    c.all = changes.length;
    for (const ch of changes) c[ch.driftStatus]++;
    return c;
  }, [changes]);

  const filtered = useMemo(() => {
    if (!changes) return [];
    if (filter === 'all') return changes;
    return changes.filter((c) => c.driftStatus === filter);
  }, [changes, filter]);

  // Group by owning Action (taskUid in the projection — confusingly
  // named because the field pre-dates V2; for V2 rows it's the
  // plan_item uid).
  const grouped = useMemo(() => {
    const map = new Map<string, { description: string; rows: ProposedChange[] }>();
    for (const ch of filtered) {
      const slot = map.get(ch.taskUid) ?? { description: ch.taskDescription, rows: [] };
      slot.rows.push(ch);
      map.set(ch.taskUid, slot);
    }
    return Array.from(map.entries());
  }, [filtered]);

  if (changes === null) {
    return (
      <section className="rounded-xl border border-white/[0.06] bg-white/[0.015] p-5 text-center text-foreground-subtle text-[13px]">
        <Loader2 size={16} className="mx-auto animate-spin opacity-70" />
      </section>
    );
  }

  if (changes.length === 0) {
    return (
      <section className="rounded-xl border border-dashed border-white/[0.08] bg-white/[0.015] p-5 space-y-1.5 text-[13.5px]">
        <div className="flex items-center gap-2 text-foreground-muted font-medium">
          <GitCompare size={14} className="text-foreground-subtle" />
          Plan diff
        </div>
        <p className="text-foreground-subtle leading-relaxed">
          No architectural intent yet. Add an Action with files, symbols, or edges to see drift here.
        </p>
      </section>
    );
  }

  return (
    <section className="rounded-xl border border-white/[0.08] bg-white/[0.02] p-4 space-y-3">
      <header className="flex items-center gap-2">
        <button
          onClick={() => setCollapsed((v) => !v)}
          className="flex items-center gap-2 text-[13.5px] font-medium text-foreground hover:text-accent transition-colors"
          title="Collapse / expand"
        >
          <ChevronRight
            size={13}
            className={`transition-transform ${collapsed ? '' : 'rotate-90'} text-foreground-subtle`}
          />
          <GitCompare size={14} className="text-accent" />
          Plan diff
          <span className="text-foreground-subtle font-normal">· {counts.all}</span>
        </button>
        <div className="flex-1" />
        <button
          onClick={fetchChanges}
          className="flex items-center gap-1.5 px-2.5 py-1 text-[12px] rounded-full border border-white/[0.08] bg-white/[0.02] text-foreground-subtle hover:text-foreground hover:bg-white/[0.04]"
          title="Refresh — drift recomputes against current graph state"
        >
          <RefreshCw size={11} className={loading ? 'animate-spin' : ''} />
          Refresh
        </button>
      </header>

      {!collapsed && (
        <>
          {/* Drift filter chips */}
          <div className="flex items-center gap-1.5 flex-wrap">
            <DriftChip label="All" status="all" filter={filter} onClick={setFilter} count={counts.all} />
            <DriftChip label="Planned" status="planned" filter={filter} onClick={setFilter} count={counts.planned} />
            <DriftChip label="In progress" status="in_progress" filter={filter} onClick={setFilter} count={counts.in_progress} />
            <DriftChip label="Satisfied" status="satisfied" filter={filter} onClick={setFilter} count={counts.satisfied} />
            <DriftChip label="Missing" status="missing" filter={filter} onClick={setFilter} count={counts.missing} />
            <DriftChip label="Unexpected" status="unexpected" filter={filter} onClick={setFilter} count={counts.unexpected} />
          </div>

          {filtered.length === 0 ? (
            <p className="text-[13px] text-foreground-subtle italic px-1 leading-relaxed">
              Nothing matches the {filter} filter. Try another bucket.
            </p>
          ) : (
            <div className="space-y-2.5">
              {grouped.map(([itemUid, group]) => (
                <div key={itemUid} className="rounded-lg border border-white/[0.05] bg-white/[0.015] overflow-hidden">
                  <button
                    onClick={() => selectItem(itemUid)}
                    className="w-full text-left px-3 py-2 flex items-center gap-2.5 hover:bg-white/[0.04] transition-colors border-b border-white/[0.04]"
                    title="Open this Action"
                  >
                    <span className="text-[11.5px] uppercase tracking-wider text-accent font-semibold">
                      Action
                    </span>
                    <span className="text-[13.5px] text-foreground truncate flex-1">{group.description}</span>
                    <span className="text-[11.5px] text-foreground-subtle">{group.rows.length} change{group.rows.length === 1 ? '' : 's'}</span>
                    <ChevronRight size={13} className="text-foreground-subtle" />
                  </button>
                  <div className="divide-y divide-white/[0.04]">
                    {group.rows.map((ch) => (
                      <ChangeRow
                        key={ch.id}
                        change={ch}
                        root={root}
                        onOpenItem={() => selectItem(ch.taskUid)}
                      />
                    ))}
                  </div>
                </div>
              ))}
            </div>
          )}
        </>
      )}
    </section>
  );
}

function DriftChip({
  label, status, filter, onClick, count,
}: {
  label: string;
  status: ChangeDriftStatus | 'all';
  filter: ChangeDriftStatus | 'all';
  onClick: (s: ChangeDriftStatus | 'all') => void;
  count: number;
}) {
  const active = filter === status;
  const tint = DRIFT_TINT[status === 'all' ? 'satisfied' : status]; // 'all' uses neutral
  return (
    <button
      onClick={() => onClick(status)}
      className={`flex items-center gap-1.5 px-2.5 py-1 text-[12px] rounded-full border transition-colors ${
        active
          ? `${tint.activeBg} ${tint.activeText} ${tint.activeBorder}`
          : 'bg-white/[0.02] border-white/[0.06] text-foreground-subtle hover:text-foreground-muted'
      }`}
      disabled={count === 0 && !active}
    >
      <span>{label}</span>
      <span className="opacity-70">· {count}</span>
    </button>
  );
}

/**
 * One proposed change.
 *
 * The row used to open the owning Action — the same thing the Action
 * header directly above it already does. So the panel named a file and
 * offered no way to look at it, while spending its only click on a
 * destination you could already reach.
 *
 * A file row now opens the file. Symbols and connections have no file to
 * open, so those keep the old behaviour rather than pretending.
 */
function ChangeRow({
  change, root, onOpenItem,
}: {
  change: ProposedChange;
  root: string | null;
  onOpenItem: () => void;
}) {
  const KindIcon = CHANGE_KIND_ICON[change.kind];
  const OpIcon = OPERATION_ICON[change.operation];
  const drift = DRIFT_TINT[change.driftStatus];

  // A move reads as `old → new`; the file to open is where it landed.
  const filePath = change.kind === 'file'
    ? change.target.split(' → ').pop()!.trim()
    : null;

  const open = filePath
    ? () => { void openFileAt(absoluteFilePath(root, filePath)); }
    : onOpenItem;

  return (
    <button
      onClick={open}
      className="w-full text-left px-3 py-2 flex items-start gap-2.5 hover:bg-white/[0.04] transition-colors group"
      title={filePath ? `Read ${filePath}` : 'Open the owning Action'}
    >
      <KindIcon size={13} className="text-foreground-subtle shrink-0 mt-0.5" />
      <span className={`flex items-center gap-1 text-[11px] uppercase tracking-wider font-medium px-2 py-0.5 rounded shrink-0 ${OPERATION_TINT[change.operation]}`}>
        <OpIcon size={11} />
        {change.operation}
      </span>
      <div className="flex-1 min-w-0">
        <div className="font-mono text-[13px] text-foreground truncate">
          {change.target}
        </div>
        {change.detail && (
          <div className="text-[11.5px] text-foreground-subtle truncate">{change.detail}</div>
        )}
      </div>
      <span className={`flex items-center gap-1.5 px-2 py-0.5 rounded-full text-[11px] uppercase tracking-wider font-medium border ${drift.activeBorder} ${drift.activeBg} ${drift.activeText}`}>
        <drift.Icon size={11} />
        {DRIFT_LABEL[change.driftStatus]}
      </span>
    </button>
  );
}

const CHANGE_KIND_ICON: Record<ChangeKind, typeof FileText> = {
  file: FileText,
  symbol: Hash,
  connection: ArrowRight,
};

const OPERATION_ICON: Record<ChangeOperation, typeof Plus> = {
  add: Plus,
  modify: Pencil,
  remove: Trash,
  move: Move,
};

const OPERATION_TINT: Record<ChangeOperation, string> = {
  add:    'bg-emerald-500/10 text-emerald-300 border border-emerald-500/30',
  modify: 'bg-accent/10 text-accent border border-accent/30',
  remove: 'bg-red-500/10 text-red-300 border border-red-500/30',
  move:   'bg-amber-500/10 text-amber-300 border border-amber-500/30',
};

const DRIFT_LABEL: Record<ChangeDriftStatus, string> = {
  planned: 'planned',
  in_progress: 'in flight',
  satisfied: 'landed',
  missing: 'missing',
  unexpected: 'unexpected',
};

const DRIFT_TINT: Record<ChangeDriftStatus, {
  Icon: typeof Eye;
  activeBg: string;
  activeText: string;
  activeBorder: string;
}> = {
  planned: {
    Icon: Eye,
    activeBg: 'bg-white/[0.05]',
    activeText: 'text-foreground-muted',
    activeBorder: 'border-white/[0.12]',
  },
  in_progress: {
    Icon: Loader2,
    activeBg: 'bg-accent/15',
    activeText: 'text-accent',
    activeBorder: 'border-accent/30',
  },
  satisfied: {
    Icon: CheckCircle2,
    activeBg: 'bg-emerald-500/15',
    activeText: 'text-emerald-300',
    activeBorder: 'border-emerald-500/30',
  },
  missing: {
    Icon: AlertTriangle,
    activeBg: 'bg-red-500/15',
    activeText: 'text-red-300',
    activeBorder: 'border-red-500/30',
  },
  unexpected: {
    Icon: CircleSlash,
    activeBg: 'bg-amber-500/15',
    activeText: 'text-amber-300',
    activeBorder: 'border-amber-500/30',
  },
};
