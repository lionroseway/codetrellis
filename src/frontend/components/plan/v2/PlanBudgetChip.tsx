import { useCallback, useEffect, useRef, useState } from 'react';
import { Timer, Info } from 'lucide-react';
import type { Plan } from '@shared/types';
import {
  stateOf, formatMinutes, formatCost, type BudgetState,
} from '../../../lib/budget-format';

/**
 * Plan budget — time and cost spent, against a ceiling — Phase 29.
 *
 * See [docs/PHASE-29-SURFACING-WHAT-WE-COLLECT.md](../../../../../docs/PHASE-29-SURFACING-WHAT-WE-COLLECT.md).
 *
 * Phase 23 built all of this — turn accumulation, per-agent split,
 * overruns, a forecast with a floor under it — and shipped it reachable
 * only through MCP. `/api/plans/:uid/budget` has been answering since
 * then and nothing has asked.
 *
 * ## A ceiling is advisory, and the UI must not pretend otherwise
 *
 * `db-schema.ts` states the posture where the table is defined: *"we
 * have no mechanism to halt an agent, and pretending otherwise would be
 * worse than honest advice."* That is still true — MCP can refuse its
 * own tool calls, but nothing stops an agent writing files with its own
 * tools. So there is no stop control here, no "enforce" toggle, and the
 * popover says in words that passing a ceiling changes nothing by
 * itself. An interface implying enforcement it cannot deliver would be
 * worse than no interface.
 *
 * ## Three things that must not be rounded away
 *
 * 1. **Unknown cost is not zero.** `spentCostUsd` is null when no agent
 *    in the plan ever reported a model. Rendering that as "$0.00" would
 *    quietly report a plan as free when the truth is we cannot see what
 *    it cost. It reads "cost not reported".
 * 2. **An early forecast is not a forecast.** `forecast()` returns null
 *    below 10% completion on purpose, because dividing by a small ratio
 *    produces a number that looks precise and is noise. The popover says
 *    it is too early rather than showing a blank.
 * 3. **No ceiling is a normal state**, not an empty one. Spend is worth
 *    knowing without a budget to compare it to, so the chip shows it and
 *    offers to set one — the same shape as `PlanGitContextChip`.
 */

interface BudgetReport {
  planUid: string;
  budget: { minutes: number | null; costUsd: number | null; exempt: boolean } | null;
  spentMinutes: number;
  spentCostUsd: number | null;
  estimateMinutes: number | null;
  estimateCostUsd: number | null;
  forecastMinutes: number | null;
  forecastCostUsd: number | null;
  completionRatio: number | null;
  byAgent: Array<{ agentType: string; minutes: number; costUsd: number | null }>;
  overruns: Array<{ itemUid: string; estimateMinutes: number; spentMinutes: number }>;
  pricingVersion: string;
  pricingVersions?: string[];
}

const CHIP_STYLE: Record<BudgetState, string> = {
  over: 'border-red-500/30 bg-red-500/[0.08] text-red-300 hover:bg-red-500/15',
  warn: 'border-amber-500/30 bg-amber-500/[0.08] text-amber-300 hover:bg-amber-500/15',
  ok: 'border-emerald-500/25 bg-emerald-500/[0.06] text-emerald-300/90 hover:bg-emerald-500/12',
  exempt: 'border-white/[0.08] bg-white/[0.02] text-foreground-subtle hover:bg-white/[0.04]',
  none: 'border-white/[0.08] bg-white/[0.02] text-foreground-subtle hover:text-foreground-muted hover:bg-white/[0.04]',
};

export function PlanBudgetChip({ plan }: { plan: Plan }) {
  const [report, setReport] = useState<BudgetReport | null>(null);
  const [open, setOpen] = useState(false);
  const [minutesDraft, setMinutesDraft] = useState('');
  const [costDraft, setCostDraft] = useState('');
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState('');
  const popoverRef = useRef<HTMLDivElement>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch(`/api/plans/${encodeURIComponent(plan.uid)}/budget`);
      if (!res.ok) return;
      const data = (await res.json()) as BudgetReport;
      setReport(data);
      setMinutesDraft(data.budget?.minutes != null ? String(data.budget.minutes) : '');
      setCostDraft(data.budget?.costUsd != null ? String(data.budget.costUsd) : '');
    } catch {
      // Silent — a plan without budget data renders no chip rather than
      // an error. This is context, not a control.
    }
  }, [plan.uid]);

  useEffect(() => { void load(); }, [load]);

  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (popoverRef.current && !popoverRef.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('mousedown', handler);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', handler);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const save = async () => {
    // An empty box means "no ceiling"; anything unparseable is a typo, and the
    // two must not arrive at the server as the same thing. JSON.stringify turns
    // NaN into null, so `Number('ten')` used to read as "clear my budget" and
    // silently removed one the user had set.
    const parse = (draft: string): number | null | undefined => {
      if (draft.trim() === '') return null;
      const n = Number(draft);
      return Number.isFinite(n) && n > 0 ? n : undefined;
    };
    const minutes = parse(minutesDraft);
    const costUsd = parse(costDraft);
    if (minutes === undefined || costUsd === undefined) {
      setSaveError('Enter a positive number, or leave it empty for no ceiling.');
      return;
    }
    setSaveError('');

    setSaving(true);
    try {
      const res = await fetch(`/api/plans/${encodeURIComponent(plan.uid)}/budget`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ minutes, costUsd }),
      });
      if (res.ok) setReport((await res.json()) as BudgetReport);
      setOpen(false);
    } finally {
      setSaving(false);
    }
  };

  // No plan work recorded and no ceiling set — nothing to say yet, and a
  // chip reading "0m" before anything has happened is noise.
  if (!report || (report.spentMinutes === 0 && !report.budget)) return null;

  const state = stateOf(report);
  const { budget } = report;

  return (
    <div className="relative inline-block">
      <button
        onClick={() => setOpen((v) => !v)}
        className={`flex items-center gap-2 px-2.5 py-1 rounded-full border transition-colors ${CHIP_STYLE[state]}`}
        title="Time and cost recorded against this plan"
      >
        <Timer size={12} />
        <span className="text-[12.5px] tabular-nums">
          {formatMinutes(report.spentMinutes)}
          {budget?.minutes != null && (
            <span className="opacity-60"> / {formatMinutes(budget.minutes)}</span>
          )}
          {report.spentCostUsd !== null && (
            <span className="opacity-70 ml-1.5">{formatCost(report.spentCostUsd)}</span>
          )}
        </span>
      </button>

      {open && (
        <div
          ref={popoverRef}
          className="absolute left-0 top-full mt-1.5 w-80 z-50 bg-surface-solid/95 backdrop-blur-xl border border-white/[0.08] rounded-lg shadow-[0_0_20px_rgba(0,0,0,0.5)] p-3 text-[11.5px]"
        >
          <div className="text-foreground font-medium mb-2">Plan budget</div>

          <dl className="space-y-1">
            <Row label="Time spent" value={formatMinutes(report.spentMinutes)} />
            {report.estimateMinutes != null && (
              <Row label="Estimated" value={formatMinutes(report.estimateMinutes)} />
            )}
            <Row
              label="Forecast"
              value={
                report.forecastMinutes != null
                  ? formatMinutes(report.forecastMinutes)
                  : 'too early to say'
              }
              muted={report.forecastMinutes == null}
            />
            <Row label="Cost" value={formatCost(report.spentCostUsd)} muted={report.spentCostUsd === null} />
            {report.spentCostUsd !== null && (
              // Provenance for the only figure here that is derived rather
              // than measured. The field was declared and never rendered,
              // so the cost surface a human actually looks at carried no
              // indication of which price table produced it.
              <Row
                label="Priced under"
                value={
                  report.pricingVersion === 'mixed'
                    ? `${(report.pricingVersions ?? []).join(' + ')} (mixed)`
                    : report.pricingVersion
                }
                muted
              />
            )}
          </dl>

          {report.spentCostUsd === null && (
            <p className="mt-1.5 text-foreground-subtle/70 leading-snug">
              No agent on this plan reported a model, so its cost cannot be
              priced. That is not the same as free.
            </p>
          )}
          {report.forecastMinutes == null && report.spentMinutes > 0 && (
            <p className="mt-1.5 text-foreground-subtle/70 leading-snug">
              A forecast needs more of the plan finished before it means
              anything — projecting from one item in twenty is noise.
            </p>
          )}

          {report.byAgent.length > 1 && (
            <div className="mt-2.5 pt-2 border-t border-white/[0.06]">
              <div className="text-foreground-subtle mb-1">By agent</div>
              {report.byAgent.map((a) => (
                <div key={a.agentType} className="flex justify-between gap-2 text-foreground-subtle/80">
                  <span className="truncate">{a.agentType}</span>
                  <span className="tabular-nums shrink-0">{formatMinutes(a.minutes)}</span>
                </div>
              ))}
            </div>
          )}

          {report.overruns.length > 0 && (
            <div className="mt-2.5 pt-2 border-t border-white/[0.06]">
              <div className="text-foreground-subtle mb-1">
                Past their estimate ({report.overruns.length})
              </div>
              {report.overruns.slice(0, 3).map((o) => (
                <div key={o.itemUid} className="flex justify-between gap-2 text-foreground-subtle/80">
                  <span className="font-mono truncate">{o.itemUid.slice(0, 8)}</span>
                  <span className="tabular-nums shrink-0">
                    {formatMinutes(o.spentMinutes)} vs {formatMinutes(o.estimateMinutes)}
                  </span>
                </div>
              ))}
            </div>
          )}

          <div className="mt-2.5 pt-2 border-t border-white/[0.06]">
            <div className="text-foreground-subtle mb-1.5">Ceiling</div>
            <div className="flex items-center gap-2">
              <input
                value={minutesDraft}
                onChange={(e) => setMinutesDraft(e.target.value)}
                inputMode="numeric"
                placeholder="minutes"
                className="w-full bg-black/25 border border-white/[0.08] rounded px-2 py-1 text-[11.5px] text-foreground placeholder:text-foreground-subtle/50 focus:outline-none focus:border-accent/40"
              />
              <input
                value={costDraft}
                onChange={(e) => setCostDraft(e.target.value)}
                inputMode="decimal"
                placeholder="USD"
                className="w-full bg-black/25 border border-white/[0.08] rounded px-2 py-1 text-[11.5px] text-foreground placeholder:text-foreground-subtle/50 focus:outline-none focus:border-accent/40"
              />
              <button
                onClick={save}
                disabled={saving}
                className="shrink-0 px-2.5 py-1 rounded border border-white/[0.08] bg-white/[0.03] hover:bg-white/[0.08] text-foreground-muted hover:text-foreground transition-colors disabled:opacity-50"
              >
                {saving ? '…' : 'Save'}
              </button>
            </div>

            {saveError && (
              <p className="mt-1.5 text-[10.5px] text-red-300 leading-snug">{saveError}</p>
            )}

            {/* The posture db-schema.ts sets where the table is defined.
                Said plainly, because an interface that implies
                enforcement it cannot deliver is worse than none. */}
            <p className="mt-1.5 flex gap-1.5 text-foreground-subtle/70 leading-snug">
              <Info size={11} className="shrink-0 mt-px" />
              <span>
                A ceiling is advisory. CodeTrellis cannot halt an agent — it
                warns, and the decision stays yours.
              </span>
            </p>
          </div>
        </div>
      )}
    </div>
  );
}

function Row({ label, value, muted }: { label: string; value: string; muted?: boolean }) {
  return (
    <div className="flex justify-between gap-2">
      <dt className="text-foreground-subtle">{label}</dt>
      <dd className={`tabular-nums shrink-0 ${muted ? 'text-foreground-subtle/60 italic' : 'text-foreground-muted'}`}>
        {value}
      </dd>
    </div>
  );
}
