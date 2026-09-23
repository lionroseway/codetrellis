import { useCallback, useEffect, useState } from 'react';
import { ChevronRight, ListChecks, Loader2, Play, AlertTriangle, RefreshCw, CheckCircle2 } from 'lucide-react';
import type { CheckRun } from '@shared/types';

/**
 * "Run checks" — Phase 31 §8.3.
 *
 * Re-hashes every recorded file on the plan and re-runs every criterion's
 * mechanical checks, then records the run. The headline is what moved since
 * the last run ("1 went stale — in/ledger.csv changed"), because a list of
 * forty passes says nothing and the difference is what a person acts on.
 *
 * A run never approves anything, and the panel says so: it can report a
 * criterion stale or failing, and only a person moves one to met.
 *
 * Runs also arrive from elsewhere — an agent's `run_checks`, or the
 * artefact watcher when a material changes — so the panel re-reads on the
 * `plan-check-run` event rather than only after its own button.
 */
export function PlanCheckRunPanel({ planUid }: { planUid: string }) {
  const [open, setOpen] = useState(false);
  const [last, setLast] = useState<CheckRun | null>(null);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch(`/api/plans/${encodeURIComponent(planUid)}/check-runs?limit=1`);
      if (!res.ok) return;
      const runs = (await res.json()) as CheckRun[];
      setLast(runs[0] ?? null);
    } catch { /* no run to show is an honest state */ }
  }, [planUid]);

  useEffect(() => { void load(); }, [load]);
  useEffect(() => {
    const onRun = (e: Event) => {
      if ((e as CustomEvent).detail?.planUid === planUid) void load();
    };
    window.addEventListener('plan-check-run', onRun);
    return () => window.removeEventListener('plan-check-run', onRun);
  }, [planUid, load]);

  const run = async () => {
    setRunning(true);
    setError(null);
    try {
      const res = await fetch(`/api/plans/${encodeURIComponent(planUid)}/check-runs`, { method: 'POST' });
      const data = await res.json().catch(() => null);
      if (!res.ok) throw new Error(data?.error || `HTTP ${res.status}`);
      setLast(data as CheckRun);
      setOpen(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setRunning(false);
    }
  };

  const failing = last?.outcomes.filter((o) => !o.ok) ?? [];
  const stale = last?.outcomes.filter((o) => o.state === 'stale') ?? [];
  const trouble = failing.length + stale.length;

  return (
    <section data-testid="check-run-panel" className="rounded-xl border border-white/[0.06] bg-white/[0.02] overflow-hidden">
      <div className="flex items-center gap-2 px-3.5 py-2.5">
        <button
          onClick={() => setOpen((v) => !v)}
          className="flex items-center gap-2 flex-1 min-w-0 text-left hover:text-foreground"
          aria-expanded={open}
        >
          <ChevronRight size={13} className={`text-foreground-subtle transition-transform ${open ? 'rotate-90' : ''}`} />
          <ListChecks size={13} className="text-foreground-subtle" />
          <span className="text-[12.5px] text-foreground font-medium">Checks</span>
          {last ? (
            <span className="ml-2 text-[10.5px] text-foreground-subtle truncate">
              {trouble === 0 ? (
                <span className="inline-flex items-center gap-1"><CheckCircle2 size={10} className="text-emerald-400" /> all {last.outcomes.length} hold</span>
              ) : (
                <span className="inline-flex items-center gap-1 text-amber-300"><AlertTriangle size={10} /> {trouble} need attention</span>
              )}
              {' · '}last run {new Date(last.startedAt).toLocaleString()}
            </span>
          ) : (
            <span className="ml-2 text-[10.5px] text-foreground-subtle">never run</span>
          )}
        </button>
        <button
          onClick={() => void run()}
          disabled={running}
          className="shrink-0 inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md border border-white/[0.08] bg-white/[0.03] hover:bg-white/[0.08] text-[11.5px] text-foreground-muted hover:text-foreground transition-colors disabled:opacity-50"
          title="Re-hash every recorded file and re-run every criterion's checks. Approves nothing."
        >
          {running ? <Loader2 size={11} className="animate-spin" /> : last ? <RefreshCw size={11} /> : <Play size={11} />}
          Run checks
        </button>
      </div>

      {error && <p className="px-3.5 pb-2.5 text-[11px] text-red-300">{error}</p>}

      {open && last && (
        <div className="px-3.5 pb-3.5 space-y-3 text-[11.5px]">
          <ul data-testid="check-run-since" className="space-y-0.5 text-foreground-muted">
            {last.sinceLast.map((line) => <li key={line}>{line}</li>)}
          </ul>

          {stale.length > 0 && (
            <div className="space-y-1">
              <div className="text-[10.5px] uppercase tracking-wider text-foreground-subtle">Stale — approved, then a file changed</div>
              {stale.map((o) => (
                <div key={o.criterionUid} className="rounded-md border border-amber-500/20 bg-amber-500/[0.05] px-2.5 py-1.5">
                  <div className="text-foreground">↻ stale · {o.text}</div>
                  {o.changedFiles.length > 0 && (
                    <div className="text-foreground-subtle font-mono text-[10.5px]">{o.changedFiles.join(', ')} changed</div>
                  )}
                </div>
              ))}
            </div>
          )}

          {failing.length > 0 && (
            <div className="space-y-1">
              <div className="text-[10.5px] uppercase tracking-wider text-foreground-subtle">Failing a check</div>
              {failing.map((o) => (
                <div key={o.criterionUid} className="rounded-md border border-red-500/20 bg-red-500/[0.05] px-2.5 py-1.5">
                  <div className="text-foreground">✕ failing · {o.text}</div>
                  <ul className="text-foreground-muted">
                    {o.failures.map((f) => <li key={f}>{f}</li>)}
                  </ul>
                </div>
              ))}
            </div>
          )}

          <p className="text-[10.5px] text-foreground-subtle">
            {last.outcomes.length} criteria checked ({last.trigger === 'material_changed' ? 'a material changed' : last.trigger}, by {last.by}).
            A check run approves nothing — only a person marks a criterion met.
          </p>
        </div>
      )}
    </section>
  );
}
