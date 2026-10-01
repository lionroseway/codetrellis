import { useCallback, useEffect, useState } from 'react';
import type { RecurringSeries } from '../../shared/types/recurring';

/**
 * Phase 32 C4.2a — the project's recurring playbooks, read again whenever one
 * is set, started or left for now (`recurring-changed`), and when a plan in it
 * changes state (a run done or archived changes its mark in the series).
 */
export function useRecurring(root: string | null): { series: RecurringSeries[]; reload: () => Promise<void> } {
  const [series, setSeries] = useState<RecurringSeries[]>([]);

  const reload = useCallback(async () => {
    if (!root) { setSeries([]); return; }
    try {
      const res = await fetch(`/api/recurring?project=${encodeURIComponent(root)}`);
      if (res.ok) setSeries(((await res.json()) as { series: RecurringSeries[] }).series);
    } catch { /* keeps what is shown */ }
  }, [root]);

  useEffect(() => {
    void reload();
    const run = () => { void reload(); };
    window.addEventListener('recurring-changed', run);
    window.addEventListener('stack-changed', run);
    return () => {
      window.removeEventListener('recurring-changed', run);
      window.removeEventListener('stack-changed', run);
    };
  }, [reload]);

  return { series, reload };
}

/** Start the run due now; the answer names the plan, made now or found. */
export async function startRecurringRun(root: string, ruleId: string): Promise<{ planUid: string; title: string; created: boolean }> {
  const res = await fetch(`/api/recurring/${encodeURIComponent(ruleId)}/start?project=${encodeURIComponent(root)}`, { method: 'POST' });
  const body = (await res.json().catch(() => ({}))) as { planUid?: string; title?: string; created?: boolean; error?: string };
  if (!res.ok || !body.planUid) throw new Error(body.error ?? `Server returned ${res.status}`);
  return { planUid: body.planUid, title: body.title ?? '', created: !!body.created };
}

/** Phase 32 C4.2b — which series a plan is a run of: its line, and the tasks it carried. */
export interface PlanRecurrence {
  rule: string;
  title: string;
  period: string;
  label: string;
  line: string;
  words: string;
  carriedTasks: Array<{ itemUid: string; title: string; from: string }>;
}

export function usePlanRecurrence(planUid: string | null): PlanRecurrence | null {
  const [recurrence, setRecurrence] = useState<PlanRecurrence | null>(null);
  useEffect(() => {
    if (!planUid) { setRecurrence(null); return; }
    let live = true;
    fetch(`/api/plans/${encodeURIComponent(planUid)}/recurrence`)
      .then((r) => (r.ok ? r.json() : { recurrence: null }))
      .then((b: { recurrence: PlanRecurrence | null }) => { if (live) setRecurrence(b.recurrence); })
      .catch(() => { if (live) setRecurrence(null); });
    return () => { live = false; };
  }, [planUid]);
  return recurrence;
}
