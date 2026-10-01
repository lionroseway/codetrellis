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
