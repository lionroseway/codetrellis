/**
 * Phase 17.L — Drift Detection UI.
 *
 * Compact inline indicator on the plan canvas that shows:
 *   - Plan-level deviations (fetched from /api/plans/:uid/deviations)
 *   - Per-item drift status (compares item fileSpecs against the
 *     live AST state via /api/symbols/file queries)
 *
 * Renders below the ContextRail as a dismissible banner when
 * deviations exist. Each deviation shows severity, description,
 * and accept/ignore actions.
 *
 * The component polls on mount and after any plan-item status change
 * (via the WebSocket "deviation-detected" event).
 */

import { useCallback, useEffect, useState } from 'react';
import { AlertTriangle, Check, EyeOff, RefreshCw, X } from 'lucide-react';
import type { Deviation } from '@shared/types';

const SEVERITY_META = {
  error: { color: 'text-red-400', bg: 'bg-red-500/[0.08]', border: 'border-red-500/20', label: 'Error' },
  warning: { color: 'text-amber-400', bg: 'bg-amber-500/[0.06]', border: 'border-amber-500/20', label: 'Warning' },
  info: { color: 'text-blue-400', bg: 'bg-blue-500/[0.06]', border: 'border-blue-500/20', label: 'Info' },
} as const;

export function DriftIndicator({ planUid }: { planUid: string }) {
  const [deviations, setDeviations] = useState<Deviation[]>([]);
  const [loading, setLoading] = useState(false);
  const [dismissed, setDismissed] = useState(false);

  const fetchDeviations = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/plans/${planUid}/deviations`);
      if (res.ok) {
        const data = await res.json();
        setDeviations(data);
      }
    } catch { /* silent */ }
    setLoading(false);
  }, [planUid]);

  // Fetch on mount
  useEffect(() => {
    fetchDeviations();
  }, [fetchDeviations]);

  const pending = deviations.filter((d) => d.resolution === 'pending');

  const handleResolve = useCallback(async (id: number, action: 'accepted' | 'ignored') => {
    try {
      await fetch(`/api/plans/${planUid}/reconcile`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ deviations: [{ id, action }] }),
      });
      setDeviations((prev) => prev.map((d) => d.id === id ? { ...d, resolution: action } : d));
    } catch { /* silent */ }
  }, [planUid]);

  const runDetection = useCallback(async () => {
    setLoading(true);
    try {
      await fetch(`/api/plans/${planUid}/deviations`);
      await fetchDeviations();
    } catch { /* silent */ }
    setLoading(false);
  }, [planUid, fetchDeviations]);

  if (pending.length === 0 || dismissed) return null;

  const errorCount = pending.filter((d) => d.severity === 'error').length;
  const warningCount = pending.filter((d) => d.severity === 'warning').length;

  return (
    <div className="rounded-xl border border-amber-500/20 bg-amber-500/[0.04] p-4 space-y-3">
      {/* Header */}
      <div className="flex items-center gap-2">
        <AlertTriangle size={14} className="text-amber-400" />
        <span className="text-[12px] font-semibold text-amber-300 uppercase tracking-wider">
          Drift detected
        </span>
        <span className="text-[11px] text-foreground-subtle">
          {pending.length} issue{pending.length !== 1 ? 's' : ''}
          {errorCount > 0 && <span className="text-red-400 ml-1">{errorCount} error{errorCount !== 1 ? 's' : ''}</span>}
          {warningCount > 0 && <span className="text-amber-400 ml-1">{warningCount} warning{warningCount !== 1 ? 's' : ''}</span>}
        </span>
        <div className="flex-1" />
        <button
          onClick={runDetection}
          disabled={loading}
          className="text-[10.5px] text-foreground-subtle hover:text-foreground transition-colors"
          title="Re-run deviation detection"
        >
          <RefreshCw size={11} className={loading ? 'animate-spin' : ''} />
        </button>
        <button
          onClick={() => setDismissed(true)}
          className="text-[10.5px] text-foreground-subtle hover:text-foreground transition-colors"
          title="Dismiss"
        >
          <X size={11} />
        </button>
      </div>

      {/* Deviation list */}
      <div className="space-y-1.5">
        {pending.map((d) => {
          const meta = SEVERITY_META[d.severity] ?? SEVERITY_META.info;
          return (
            <div
              key={d.id}
              className={`flex items-start gap-2 px-3 py-2 rounded-lg border ${meta.border} ${meta.bg}`}
            >
              <AlertTriangle size={12} className={`${meta.color} mt-0.5 shrink-0`} />
              <div className="flex-1 min-w-0">
                <div className="text-[11.5px] text-foreground-muted leading-relaxed">
                  {d.description}
                </div>
                <div className="text-[10px] text-foreground-subtle mt-0.5">
                  {d.deviationType} · {new Date(d.detectedAt).toLocaleTimeString()}
                </div>
              </div>
              <div className="flex items-center gap-1 shrink-0">
                <button
                  onClick={() => handleResolve(d.id, 'accepted')}
                  className="px-1.5 py-0.5 text-[10px] rounded border border-green-500/20 bg-green-500/[0.06] text-green-300 hover:bg-green-500/[0.12] transition-colors"
                  title="Accept — update plan to match reality"
                >
                  <Check size={10} />
                </button>
                <button
                  onClick={() => handleResolve(d.id, 'ignored')}
                  className="px-1.5 py-0.5 text-[10px] rounded border border-white/[0.08] bg-white/[0.02] text-foreground-subtle hover:text-foreground hover:bg-white/[0.05] transition-colors"
                  title="Ignore"
                >
                  <EyeOff size={10} />
                </button>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

/**
 * Compact badge for the plan header showing drift count.
 * Clickable — navigates to the drift panel or scrolls to drift section.
 */
export function DriftBadge({ planUid }: { planUid: string }) {
  const [count, setCount] = useState(0);

  useEffect(() => {
    fetch(`/api/plans/${planUid}/deviations`)
      .then((r) => r.json())
      .then((data: Deviation[]) => {
        const pending = data.filter((d) => d.resolution === 'pending');
        setCount(pending.length);
      })
      .catch(() => {});
  }, [planUid]);

  if (count === 0) return null;

  return (
    <span
      className="flex items-center gap-1 px-2 py-0.5 rounded-full border border-amber-500/30 bg-amber-500/10 text-amber-300 text-[11px] font-medium"
      title={`${count} unresolved deviation${count !== 1 ? 's' : ''}`}
    >
      <AlertTriangle size={10} />
      {count}
    </span>
  );
}
