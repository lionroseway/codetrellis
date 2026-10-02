import { useCallback, useEffect, useMemo, useState } from 'react';
import { Zap, ArrowRight, Lock } from 'lucide-react';
import { revealPlanItem } from '../../../lib/open-plan-item';
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
 * Phase 32 B6.1 — what the server says each held task waits on. The count
 * used to be worked out here from the one plan the window had loaded, so a
 * dependency in another plan was never found and counted as blocked for
 * ever, even after it was done there (bug 11).
 */
export interface DependencyWait {
  uid: string;
  problem: 'unfinished' | 'missing' | 'page';
  title: string | null;
  planUid: string | null;
  planTitle: string | null;
  words: string;
}
export interface ItemWait {
  itemUid: string;
  itemTitle: string;
  waits: DependencyWait[];
  sentence: string;
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

  const [waits, setWaits] = useState<ItemWait[]>([]);

  const load = useCallback(async () => {
    try {
      const [res, waitsRes] = await Promise.all([
        fetch(`/api/plans/${planUid}/next-task`),
        fetch(`/api/plans/${planUid}/waits`),
      ]);
      if (waitsRes.ok) setWaits(((await waitsRes.json()) as { waits: ItemWait[] }).waits ?? []);
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

  const blocked = waits.length;
  const sentences = waits.map((w) => w.sentence).join('\n');

  if (!loaded) return null;

  // Nothing pending at all — the plan is done or hasn't started. The
  // completion summary already speaks to the first case and the empty
  // state to the second, so this says nothing.
  if (!next && blocked === 0) return null;

  if (!next) {
    return (
      <div data-testid="next-up-waiting" className="px-3.5 py-2 rounded-lg border border-amber-500/20 bg-amber-500/[0.05] space-y-1.5">
        <div className="flex items-center gap-2">
          <Lock size={12} className="text-amber-300 shrink-0" />
          <span className="text-[12.5px] text-amber-200/90">
            Nothing is ready to start
          </span>
          <span className="text-[11.5px] text-amber-300/60">
            {blocked} task{blocked === 1 ? '' : 's'} waiting on something unfinished
          </span>
        </div>
        <ul className="space-y-1 pl-5">
          {waits.map((w) => (
            <li key={w.itemUid} data-testid="next-up-wait" className="text-[11.5px] text-amber-100/80">
              <button className="hover:underline" onClick={() => selectItem(w.itemUid)}>“{w.itemTitle}”</button>
              {' '}
              {w.waits.map((d, i) => (
                <span key={d.uid}>
                  {i > 0 && ', and '}
                  <WaitWords wait={d} />
                </span>
              ))}
            </li>
          ))}
        </ul>
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
        <span className="text-[11px] text-foreground-subtle shrink-0" title={sentences}>
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

/**
 * One dependency in words. A task in another plan is a link to it: that is
 * where the person goes to see why it is not done.
 */
function WaitWords({ wait }: { wait: DependencyWait }) {
  if (wait.problem !== 'unfinished' || !wait.planUid || !wait.planTitle) return <>{wait.words}</>;
  const planUid = wait.planUid;
  return (
    <>
      waits on{' '}
      <button
        data-testid="next-up-wait-link"
        className="text-accent hover:underline"
        onClick={() => { void revealPlanItem(planUid, wait.uid); }}
        title={`Open “${wait.title}” in ${wait.planTitle}`}
      >
        “{wait.title}”
      </button>
      {' '}in plan “{wait.planTitle}”
    </>
  );
}
