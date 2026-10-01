import { useState } from 'react';
import { Repeat } from 'lucide-react';
import type { RecurringRun, RecurringSeries } from '../../../shared/types/recurring';
import { usePlanStore } from '../../stores/plan-store';
import { useRecurring, startRecurringRun } from '../../hooks/useRecurring';

/**
 * Phase 32 C4.2a — each recurring playbook as one row in the plans list
 * (shared-work doc C-4): its schedule in words, then one mark per period,
 * "W37 ✓ · W38 ✓ · W39 ✗ missed · W40 ◐", and the next. A run opens its
 * plan; the run due now can be started from here.
 */
const TONE: Record<RecurringRun['state'], string> = {
  done: 'text-emerald-300 border-emerald-400/25',
  in_progress: 'text-sky-200 border-sky-400/30',
  missed: 'text-rose-300/80 border-rose-400/20',
  due: 'text-amber-200 border-amber-400/40',
  next: 'text-foreground-subtle border-white/[0.06]',
};
const MARK: Record<RecurringRun['state'], string> = { done: '✓', in_progress: '◐', missed: '✗', due: 'due', next: 'next' };

export function RecurringSeriesList({ root }: { root: string | null }) {
  const { series, reload } = useRecurring(root);
  if (!root || series.length === 0) return null;
  return (
    <div className="mb-2.5 space-y-1.5" data-testid="recurring-series-list">
      {series.map((s) => <SeriesRow key={s.rule.id} root={root} series={s} onStarted={reload} />)}
    </div>
  );
}

function SeriesRow({ root, series: s, onStarted }: { root: string; series: RecurringSeries; onStarted: () => Promise<void> }) {
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const open = (uid: string) => { void usePlanStore.getState().setActivePlan(uid); };
  const start = async () => {
    setBusy(true);
    setError(null);
    try {
      const run = await startRecurringRun(root, s.rule.id);
      await onStarted();
      open(run.planUid);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="rounded-lg border border-white/[0.06] bg-white/[0.02] px-3 py-2" data-testid="recurring-series" data-rule-id={s.rule.id}>
      <div className="flex items-baseline gap-2">
        <Repeat size={12} className="text-sky-300 shrink-0 self-center" />
        <span className="text-[13px] font-medium text-foreground truncate">{s.rule.title}</span>
        <span className="text-[10.5px] text-foreground-muted truncate" data-testid="recurring-series-words">{s.words}</span>
      </div>
      <div className="mt-1.5 flex flex-wrap gap-1">
        {s.runs.map((r) => (
          r.state === 'due' ? (
            <button
              key={r.period}
              type="button"
              disabled={busy}
              onClick={() => { void start(); }}
              title={`${r.words}. Start it`}
              data-testid="recurring-run"
              data-state={r.state}
              className={`px-1.5 py-0.5 rounded border text-[10.5px] font-mono hover:bg-amber-500/10 disabled:opacity-40 ${TONE[r.state]}`}
            >
              {r.label} due · Start
            </button>
          ) : (
            <button
              key={r.period}
              type="button"
              disabled={!r.planUid}
              onClick={() => { if (r.planUid) open(r.planUid); }}
              title={r.words}
              data-testid="recurring-run"
              data-state={r.state}
              className={`px-1.5 py-0.5 rounded border text-[10.5px] font-mono ${r.planUid ? 'hover:bg-white/[0.05]' : 'cursor-default'} ${TONE[r.state]}`}
            >
              {r.label} {MARK[r.state]}{r.state === 'missed' ? ' missed' : ''}
            </button>
          )
        ))}
      </div>
      {error && <div className="mt-1 text-[10.5px] text-danger" data-testid="recurring-series-error">{error}</div>}
    </div>
  );
}
