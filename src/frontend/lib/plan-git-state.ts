/**
 * Phase 32 C2.1 — each item's state, for the plan tree and the item page:
 * building, pushed or merged, read by the backend from local refs (nothing
 * fetched); and, where the person turned on a review host (C2.2b), in review
 * or closed as the host said. Refreshed when workstreams move or the host is
 * turned on or off, and every half minute, since a merge on another machine
 * arrives by a fetch the app did not make.
 */

import { useEffect, useState } from 'react';
import type { ItemGitState } from '@shared/lib/git-state-words';
import { singleFlight } from './single-flight';

export interface PlanItemGitState extends ItemGitState {
  itemUid: string;
  fromUid: string;
  words: string;
}

const REFRESH_MS = 30_000;

/** `nonce` changes when the plan's branch assignments do, so a new assignment is read at once. */
export function usePlanGitStates(planUid: string | null, nonce = ''): Record<string, PlanItemGitState> {
  const [byItem, setByItem] = useState<Record<string, PlanItemGitState>>({});
  useEffect(() => {
    if (!planUid) { setByItem({}); return; }
    let live = true;
    const load = singleFlight(async () => {
      try {
        const res = await fetch(`/api/plans/${encodeURIComponent(planUid)}/git-state`);
        if (!res.ok) return;
        const body = (await res.json()) as { items?: PlanItemGitState[] };
        if (live) setByItem(Object.fromEntries((body.items ?? []).map((s) => [s.itemUid, s])));
      } catch { /* the tree shows no state rather than a wrong one */ }
    });
    void load();
    window.addEventListener('workstreams-changed', load);
    window.addEventListener('review-host-changed', load);
    const id = setInterval(load, REFRESH_MS);
    return () => {
      live = false;
      window.removeEventListener('workstreams-changed', load);
      window.removeEventListener('review-host-changed', load);
      clearInterval(id);
    };
  }, [planUid, nonce]);
  return byItem;
}

/** The chip's colour by state: merged green, in review violet, pushed sky, building amber, closed grey. */
export const GIT_STATE_TONE: Record<string, string> = {
  merged: 'border-emerald-400/30 bg-emerald-500/10 text-emerald-300',
  'in-review': 'border-violet-400/30 bg-violet-500/10 text-violet-300',
  pushed: 'border-sky-400/30 bg-sky-500/10 text-sky-300',
  building: 'border-amber-400/30 bg-amber-500/10 text-amber-300',
  closed: 'border-white/15 bg-white/[0.04] text-foreground-muted',
};

/** The chip's hover: the words, where they came from, the commit, and any note from the host. */
export function gitStateTitle(s: PlanItemGitState, source: string): string {
  return `${s.words} — ${source}${s.commit ? `, ${s.commit.slice(0, 7)}` : ''}${s.hostNote ? `. ${s.hostNote}` : ''}`;
}
