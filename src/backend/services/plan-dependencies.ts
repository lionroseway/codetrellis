/**
 * Phase 32 B6.1 — whether an item's dependencies are met, and if not, why.
 *
 * An item's `dependencies` are uids of other Actions, and nothing ever
 * limited them to the item's own plan: the MCP tools, the REST route and
 * plan files all accept any uid. But both "what is next" rules looked
 * dependencies up in the item's own plan only, so a dependency on another
 * plan's item was never found and the item was never offered, whatever the
 * other item's status (bug 11). A deleted item and a page (which has no
 * status) held their dependants the same way, and nothing said why.
 *
 * This is the one rule. Lookups are passed in so it stays pure: the caller
 * decides where items and plan titles come from.
 */
import type { PlanItem } from '../../shared/types';

export interface DependencyLookup {
  /** Any item, in any plan. `null` when there is no such item. */
  getItem(uid: string): PlanItem | null;
  /** A plan's title, for saying where a dependency lives. */
  planTitle(planUid: string): string | null;
}

export type DependencyProblem = 'unfinished' | 'missing' | 'page';

export interface DependencyWait {
  uid: string;
  problem: DependencyProblem;
  title: string | null;
  status: string | null;
  planUid: string | null;
  /** Set only when the dependency is in another plan. */
  planTitle: string | null;
  /** What the dependant is waiting for, in a phrase: `waits on "Migrate" in plan "Billing v2"`. */
  words: string;
}

export interface DependencyState {
  met: boolean;
  waits: DependencyWait[];
}

/** Done or skipped: nobody is going to come back to a skipped item, so it holds nothing up. */
export function isSettled(item: Pick<PlanItem, 'status'>): boolean {
  return item.status === 'done' || item.status === 'skipped';
}

/**
 * `local` is the item's own plan, already loaded, so the common case asks
 * the lookup nothing; anything not in it is looked up wherever it lives.
 */
export function dependencyState(
  item: Pick<PlanItem, 'planUid' | 'dependencies'>,
  lookup: DependencyLookup,
  local?: ReadonlyMap<string, PlanItem>,
): DependencyState {
  const waits: DependencyWait[] = [];
  for (const uid of item.dependencies ?? []) {
    const dep = local?.get(uid) ?? lookup.getItem(uid);
    if (!dep) {
      waits.push({
        uid, problem: 'missing', title: null, status: null, planUid: null, planTitle: null,
        words: `waits on an item that no longer exists (${uid})`,
      });
      continue;
    }
    const elsewhere = dep.planUid !== item.planUid;
    const planTitle = elsewhere ? lookup.planTitle(dep.planUid) : null;
    const where = elsewhere ? ` in plan "${planTitle ?? dep.planUid}"` : '';
    if (dep.kind !== 'action') {
      waits.push({
        uid, problem: 'page', title: dep.title, status: null, planUid: dep.planUid, planTitle,
        words: `depends on the page "${dep.title}"${where}, which has no status to finish`,
      });
      continue;
    }
    if (isSettled(dep)) continue;
    waits.push({
      uid, problem: 'unfinished', title: dep.title, status: dep.status ?? null, planUid: dep.planUid, planTitle,
      words: `waits on "${dep.title}"${where}`,
    });
  }
  return { met: waits.length === 0, waits };
}

/** One sentence for a blocked item: `"Deploy" waits on "Migrate" in plan "Billing v2".` */
export function waitSentence(title: string, state: DependencyState): string {
  return `"${title}" ${state.waits.map((w) => w.words).join(', and ')}.`;
}

/**
 * What is wrong with a list of dependencies before it is saved, or `null`.
 * Refused: a uid that names no item, the item itself, and a page. Each can
 * only ever hold its dependant forever. Any plan's Action is allowed.
 */
export function dependencyProblem(
  itemUid: string | null,
  dependencies: readonly string[],
  getItem: DependencyLookup['getItem'],
): string | null {
  for (const uid of dependencies) {
    if (itemUid && uid === itemUid) return 'An item cannot depend on itself.';
    const dep = getItem(uid);
    if (!dep) return `No item has the uid ${uid}.`;
    if (dep.kind !== 'action') return `"${dep.title}" is a page, not a task: it has no status to finish, so nothing could ever start after it.`;
  }
  return null;
}
