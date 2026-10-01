/**
 * Phase 32 C2.4 — a plan's status, read and never written: every item's
 * state with its source, and the plan's one status view. The same answer
 * as the phone's `plan.status` and an agent's get_plan. Refreshed when the
 * plan's items change, when workstreams move or a review host is turned on
 * or off, and every half minute (a merge elsewhere arrives by a fetch).
 */

import { useEffect, useState } from 'react';
import type { ItemStatus, PlanStatusView } from '@shared/lib/item-status';

export interface PlanStatus extends PlanStatusView {
  planUid: string;
  title: string;
  base: string | null;
  items: ItemStatus[];
}

const REFRESH_MS = 30_000;

/** `nonce` changes when the plan's items do, so a change is read at once. */
export function usePlanStatus(planUid: string | null, nonce = ''): PlanStatus | null {
  const [status, setStatus] = useState<PlanStatus | null>(null);
  useEffect(() => {
    if (!planUid) { setStatus(null); return; }
    let live = true;
    const load = async () => {
      try {
        const res = await fetch(`/api/plans/${encodeURIComponent(planUid)}/status`);
        if (!res.ok) return;
        const body = (await res.json()) as PlanStatus;
        if (live) setStatus(body);
      } catch { /* shows nothing rather than something wrong */ }
    };
    void load();
    window.addEventListener('workstreams-changed', load);
    window.addEventListener('review-host-changed', load);
    // C3.2: a task set two ways at once starts and ends with the signals.
    window.addEventListener('awareness-changed', load);
    const id = setInterval(load, REFRESH_MS);
    return () => {
      live = false;
      window.removeEventListener('workstreams-changed', load);
      window.removeEventListener('review-host-changed', load);
      window.removeEventListener('awareness-changed', load);
      clearInterval(id);
    };
  }, [planUid, nonce]);
  return status;
}

/** The chip's colour by source: the plan's own states read as firmly as git's. */
export const SOURCE_TONE: Record<string, string> = {
  plan: 'border-teal-400/25 bg-teal-500/10 text-teal-300',
  git: 'border-sky-400/25 bg-sky-500/10 text-sky-300',
  github: 'border-violet-400/25 bg-violet-500/10 text-violet-300',
  gitlab: 'border-violet-400/25 bg-violet-500/10 text-violet-300',
  bitbucket: 'border-violet-400/25 bg-violet-500/10 text-violet-300',
};
