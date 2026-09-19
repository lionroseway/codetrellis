import { useCallback, useEffect, useMemo, useState } from 'react';
import { Zap, ArrowRight, Lock } from 'lucide-react';
import { usePlanItemsStore } from '../../../stores/plan-items-store';
import type { PlanItem } from '@shared/types';

/**
 * Phase 29 §4.14 — "what should I work on next".
 *
 * `/api/plans/:uid/next-task` picks the first pending Action whose
 * dependencies are all satisfied. The tree already shows every item
 * and its status, so the thing this adds is the part the tree cannot
 * show: which of the pending Actions is actually *unblocked*. Five
 * pending actions where four are waiting on each other look identical
 * in a tree and are not the same situation.
 *
 * The selection rule stays on the server rather than being recomputed
 * here. Two implementations of "what is next" that drift apart is the
 * exact failure this phase keeps finding, and the endpoint is the
 * authority — it is what an agent asking the same question gets.
 *
 * The blocked count comes from the store instead, which already holds
 * every item, so the strip costs one request and no polling.
 */

/**
 * Actions that are pending but waiting on something unfinished. Mirrors
 * the server's notion of "done" — a skipped dependency does not hold
 * anything up, because nobody is going to come back and do it.
 */
export function countBlocked(items: PlanItem[]): number {
  const settled = new Set(
    items.filter((i) => i.status === 'done' || i.status === 'skipped').map((i) => i.uid),
  );
  return items.filter((i) =>
    i.kind === 'action'
    && i.status === 'pending'
    && (i.dependencies ?? []).some((d) => !settled.has(d)),
  ).length;
}

/**
 * The endpoint answers with a PlanItem for a V2 plan and a legacy Task
 * for a V1 one, and those name the same thing differently — `title` vs
 * `description`. A V1 plan with a description and no items renders this
 * strip (it is not "empty"), so reading `title` alone would print
 * "Next up: untitled" for every legacy plan.
 */
export function labelOf(next: { title?: string; description?: string }): string {
  const label = next.title?.trim() || next.description?.trim();
  return label || 'untitled';
}

export function NextUpStrip({ planUid }: { planUid: string }) {
  const itemsByUid = usePlanItemsStore((s) => s.itemsByUid);
  const selectItem = usePlanItemsStore((s) => s.selectItem);
  const [next, setNext] = useState<(Partial<PlanItem> & { description?: string }) | null>(null);
  const [loaded, setLoaded] = useState(false);

  const items = useMemo(() => Object.values(itemsByUid), [itemsByUid]);

  const load = useCallback(async () => {
    try {
      const res = await fetch(`/api/plans/${planUid}/next-task`);
      if (!res.ok) return;
      const data = await res.json() as (Partial<PlanItem> & { description?: string }) | { none: true };
      setNext('none' in data ? null : data);
    } catch {
      setNext(null);
    } finally {
      setLoaded(true);
    }
  }, [planUid]);

  // Re-ask whenever the item set changes — finishing an Action is
  // exactly what makes a different one next.
  useEffect(() => { load(); }, [load, items.length, items.map((i) => i.status).join(',')]);

  const blocked = useMemo(() => countBlocked(items), [items]);

  if (!loaded) return null;

  // Nothing pending at all — the plan is done or hasn't started. The
  // completion summary already speaks to the first case and the empty
  // state to the second, so this says nothing.
  if (!next && blocked === 0) return null;

  if (!next) {
    return (
      <div className="flex items-center gap-2 px-3.5 py-2 rounded-lg border border-amber-500/20 bg-amber-500/[0.05]">
        <Lock size={12} className="text-amber-300 shrink-0" />
        <span className="text-[12.5px] text-amber-200/90">
          Nothing is ready to start
        </span>
        <span className="text-[11.5px] text-amber-300/60">
          {blocked} action{blocked === 1 ? '' : 's'} waiting on something unfinished
        </span>
      </div>
    );
  }

  return (
    <button
      onClick={() => { if (next.uid) selectItem(next.uid); }}
      className="w-full flex items-center gap-2 px-3.5 py-2 rounded-lg border border-accent/20 bg-accent/[0.05] hover:bg-accent/[0.09] hover:border-accent/35 text-left transition-colors group"
    >
      <Zap size={12} className="text-accent shrink-0" />
      <span className="text-[11px] uppercase tracking-wider text-foreground-subtle shrink-0">
        Next up
      </span>
      <span className="text-[12.5px] text-foreground truncate">
        {labelOf(next)}
      </span>
      {blocked > 0 && (
        <span className="text-[11px] text-foreground-subtle shrink-0">
          {blocked} blocked
        </span>
      )}
      <span className="flex-1" />
      <ArrowRight
        size={12}
        className="text-foreground-subtle group-hover:text-accent shrink-0 transition-colors"
      />
    </button>
  );
}
