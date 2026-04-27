import { useEffect, useState } from 'react';
import { CheckCircle2, AlertCircle, Loader2, Circle, RefreshCw } from 'lucide-react';
import type { ChangeDriftStatus, ChangeKind, ChangeOperation } from '@shared/types';

/**
 * "Are we done?" verification surface — closes step 11 of the
 * front-to-back loop. Uses the same `plan-changes-service` data the
 * Proposed Changes tab does, but boiled down to a single one-glance
 * card the human can read without opening every task.
 *
 * Three states:
 *   - **Green**: every proposed change is satisfied → ready to ship.
 *   - **Amber**: some changes still planned / in progress → mid-flight.
 *   - **Red**: at least one change is "missing" (a task was marked
 *     done but the change isn't reflected in the live state).
 */

interface ChangesSummary {
  total: number;
  byStatus: Record<ChangeDriftStatus, number>;
  byKind: Record<ChangeKind, number>;
  byOperation: Record<ChangeOperation, number>;
}

export function VerificationPanel({ planUid }: { planUid: string }) {
  const [summary, setSummary] = useState<ChangesSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshTick, setRefreshTick] = useState(0);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    fetch(`/api/plans/${planUid}/changes?summary=1`)
      .then((r) => r.json())
      .then((data: ChangesSummary) => {
        if (cancelled) return;
        setSummary(data);
        setLoading(false);
      })
      .catch(() => {
        if (cancelled) return;
        setLoading(false);
      });
    return () => { cancelled = true; };
  }, [planUid, refreshTick]);

  if (loading && !summary) {
    return (
      <div className="rounded-lg border border-white/[0.06] bg-white/[0.015] px-3 py-2 text-[10.5px] text-foreground-subtle flex items-center gap-2">
        <Loader2 size={11} className="animate-spin" /> Computing completion…
      </div>
    );
  }

  if (!summary || summary.total === 0) {
    // Empty state — plan has no proposed changes (no affected files /
    // symbol_specs / connections on any task). Don't draw anything;
    // the verification panel would be confusing.
    return null;
  }

  const { byStatus, total } = summary;
  const satisfied = byStatus.satisfied;
  const inProgress = byStatus.in_progress;
  const planned = byStatus.planned;
  const missing = byStatus.missing;
  const unexpected = byStatus.unexpected;

  const pct = Math.round((satisfied / total) * 100);
  const allSatisfied = satisfied === total;
  const hasMissing = missing > 0 || unexpected > 0;

  // Headline tint
  let headline = 'Mid-flight';
  let HeadlineIcon = Loader2;
  let headlineTint = 'text-accent';
  let barTint = 'bg-accent/70';
  if (allSatisfied) {
    headline = 'Ready to ship';
    HeadlineIcon = CheckCircle2;
    headlineTint = 'text-green-400';
    barTint = 'bg-green-500/70';
  } else if (hasMissing) {
    headline = 'Drifted';
    HeadlineIcon = AlertCircle;
    headlineTint = 'text-amber-400';
    barTint = 'bg-amber-400/70';
  } else if (inProgress === 0 && planned > 0 && satisfied === 0) {
    headline = 'Not started';
    HeadlineIcon = Circle;
    headlineTint = 'text-zinc-400';
    barTint = 'bg-zinc-500/50';
  }

  return (
    <div className={`rounded-lg border ${allSatisfied ? 'border-green-500/30 bg-green-500/[0.04]' : hasMissing ? 'border-amber-400/25 bg-amber-400/[0.03]' : 'border-white/[0.06] bg-white/[0.015]'} px-3 py-2.5 space-y-2`}>
      <div className="flex items-center gap-2">
        <HeadlineIcon size={13} className={`${headlineTint} ${HeadlineIcon === Loader2 && inProgress > 0 ? 'animate-spin' : ''} shrink-0`} />
        <span className={`text-[12px] font-semibold ${headlineTint}`}>{headline}</span>
        <span className="text-[10px] text-foreground-subtle ml-auto">
          {satisfied}/{total} satisfied · {pct}%
        </span>
        <button
          onClick={() => setRefreshTick((n) => n + 1)}
          className="p-1 rounded text-foreground-subtle hover:text-foreground hover:bg-white/[0.05]"
          title="Re-compute drift status"
        >
          <RefreshCw size={10} />
        </button>
      </div>

      {/* Stacked progress bar */}
      <div className="h-1.5 rounded-full bg-white/[0.05] overflow-hidden flex">
        {satisfied > 0 && (
          <div className={`${barTint}`} style={{ width: `${(satisfied / total) * 100}%` }} title={`${satisfied} satisfied`} />
        )}
        {inProgress > 0 && (
          <div className="bg-accent/50" style={{ width: `${(inProgress / total) * 100}%` }} title={`${inProgress} in progress`} />
        )}
        {missing > 0 && (
          <div className="bg-amber-400/60" style={{ width: `${(missing / total) * 100}%` }} title={`${missing} missing`} />
        )}
        {unexpected > 0 && (
          <div className="bg-red-400/60" style={{ width: `${(unexpected / total) * 100}%` }} title={`${unexpected} unexpected`} />
        )}
        {planned > 0 && (
          <div className="bg-white/[0.06]" style={{ width: `${(planned / total) * 100}%` }} title={`${planned} planned`} />
        )}
      </div>

      {/* Status legend — only show non-zero buckets */}
      <div className="flex items-center gap-3 text-[9.5px] flex-wrap">
        {satisfied > 0 && <Legend tint="text-green-400" label="Satisfied" count={satisfied} />}
        {inProgress > 0 && <Legend tint="text-accent" label="In progress" count={inProgress} />}
        {planned > 0 && <Legend tint="text-zinc-400" label="Planned" count={planned} />}
        {missing > 0 && <Legend tint="text-amber-400" label="Missing" count={missing} />}
        {unexpected > 0 && <Legend tint="text-red-400" label="Unexpected" count={unexpected} />}
      </div>

      {hasMissing && (
        <p className="text-[10px] text-amber-200/80 leading-relaxed">
          {missing > 0 && <>{missing} change{missing === 1 ? '' : 's'} from a "done" task aren't visible in the live state. </>}
          {unexpected > 0 && <>{unexpected} change{unexpected === 1 ? '' : 's'} appeared without any task claiming them. </>}
          Open the <em>Proposed</em> tab to drill in.
        </p>
      )}
    </div>
  );
}

function Legend({ tint, label, count }: { tint: string; label: string; count: number }) {
  return (
    <span className="flex items-center gap-1">
      <span className={`w-1.5 h-1.5 rounded-full ${bgFromTint(tint)}`} />
      <span className={tint}>{label}</span>
      <span className="text-foreground-subtle">{count}</span>
    </span>
  );
}

function bgFromTint(tint: string): string {
  // Tailwind doesn't dynamically generate classes — map known tints to
  // static bg classes so the legend dots actually have a background.
  if (tint.includes('green')) return 'bg-green-400/80';
  if (tint.includes('amber')) return 'bg-amber-400/80';
  if (tint.includes('red')) return 'bg-red-400/80';
  if (tint.includes('accent')) return 'bg-accent/80';
  return 'bg-zinc-400/80';
}
