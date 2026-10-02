/**
 * Phase 32 B6.2 — the stack: every active plan in a project, and its tasks,
 * in one answer (observability spec §5, JOURNEYS H1).
 *
 * Until now no view showed several plans at once: the plan list is flat, and
 * the item tree shows one plan. Rows are plans, called by their ticket key
 * when they have one. "Active" is the review queue's rule: not completed and
 * not archived. Each task carries who is on it, the branch it is worked on,
 * and its dependencies resolved across plans by B6.1's one rule, so a task
 * waiting on another plan's task says so here as everywhere else.
 *
 * Plans are rows in the database per project, not part of the one graph the
 * server holds, so any opened project's stack can be read; the route and the
 * MCP scope keep it to opened projects.
 */
import type { Plan, PlanItem } from '../../shared/types';
import type { Stack, StackDependency, StackPlan, StackRead, StackTask } from '../../shared/types/stack';
import { listPlans } from './plan-service';
import { listAllItems, dependencyLookup } from './plan-item-service';
import { dependencyState, waitSentence, type DependencyLookup } from './plan-dependencies';
import { resolveSection } from './section-workstreams';
import { getPlanExternalRefs } from './external-intake-service';
import { arrivalWords, getPlanArrival } from './plan-arrivals';
import { getExternalRefs } from './external-refs-service';
import { listHits } from './breakpoint-service';
import { listWorktrees } from './worktree-service';
import { loadSignals } from './awareness-service';
import { declaredFootprint, stackOverlaps, type PlanFootprint } from './stack-overlaps';
import { getDb } from './database';
import { isSettled } from './plan-dependencies';
import { taskWorkstreamId, TASK_PREFIX } from './task-workstreams';
import fs from 'node:fs';

const DONE: ReadonlySet<string> = new Set(['completed', 'archived']);

export interface StackSources extends DependencyLookup {
  planTicketKey(planUid: string): string | null;
  itemTicketKey(itemUid: string): string | null;
  waitingHits(planUid: string): number;
  /** The task's latest read of each material, by then for a past moment (HD3). */
  readsOf?(itemUid: string): StackRead[];
  /** Materials attached, as a brief lists them, to these items (HD3). */
  materialsOn?(itemUids: readonly string[]): string[];
  /** C2.6a — how a plan reached this machine through its files, in words; null when made here. */
  arrivalOf?(planUid: string): string | null;
}

const DAY_MONTH = new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', timeZone: 'UTC' });

/** `read sales-2026.xlsx on 22 Sept (version 3f9c2e1)`: which copy of a material a task worked from. */
export function readWords(path: string, sha256: string | null, at: number): string {
  const name = path.split(/[\\/]/).pop() || path;
  return `read ${name} on ${DAY_MONTH.format(new Date(at))}${sha256 ? ` (version ${sha256.slice(0, 7)})` : ''}`;
}

/** Each material's latest read by the task, up to `before` when given (A6.2's `material_reads`). */
function readsFromDb(itemUid: string, before?: number): StackRead[] {
  const res = getDb().exec(
    `SELECT path, sha256, at FROM material_reads WHERE item_uid = ?${before !== undefined ? ' AND at <= ?' : ''} ORDER BY at, rowid`,
    before !== undefined ? [itemUid, before] : [itemUid],
  );
  const latest = new Map<string, StackRead>();
  for (const [path, sha, at] of res[0]?.values ?? []) {
    const p = String(path);
    latest.delete(p);
    latest.set(p, { path: p, sha256: (sha as string | null) ?? null, at: Number(at), words: readWords(p, (sha as string | null) ?? null, Number(at)) });
  }
  return [...latest.values()];
}

/** Materials attached to these items, as their briefs list them, attached by `before` when given. */
function materialsFromDb(itemUids: readonly string[], before?: number): string[] {
  if (!itemUids.length) return [];
  const marks = itemUids.map(() => '?').join(',');
  const res = getDb().exec(
    `SELECT DISTINCT value FROM attachments WHERE role = 'material' AND target_uid IN (${marks})${before !== undefined ? ' AND created_at <= ?' : ''}`,
    before !== undefined ? [...itemUids, before] : [...itemUids],
  );
  return (res[0]?.values ?? []).map((r) => String(r[0]));
}

/** The files an item names: its file specs (and where they move to), and the files its symbol specs live in. */
function filesOf(item: PlanItem): string[] {
  const files = new Set<string>();
  for (const f of item.fileSpecs ?? []) {
    if (f.isDir) continue;
    if (f.path) files.add(f.path);
    if (f.moveTo) files.add(f.moveTo);
  }
  for (const s of item.symbolSpecs ?? []) if (s.filePath) files.add(s.filePath);
  return [...files];
}

/** One plan's row, from its items. Pure: every lookup is passed in. */
export function stackPlanOf(
  plan: Pick<Plan, 'uid' | 'title' | 'status'>,
  items: PlanItem[],
  sources: StackSources,
): StackPlan {
  const local = new Map(items.map((i) => [i.uid, i]));
  const within = (uid: string) => local.get(uid) ?? sources.getItem(uid);
  const actions = items.filter((i) => i.kind === 'action');
  const ticketKey = sources.planTicketKey(plan.uid);

  const tasks: StackTask[] = items.map((item) => {
    const state = item.kind === 'action' ? dependencyState(item, sources, local) : { met: true, waits: [] };
    const unmet = new Map(state.waits.map((w) => [w.uid, w]));
    const dependencies: StackDependency[] = (item.dependencies ?? []).map((uid) => {
      const wait = unmet.get(uid);
      if (wait) {
        return { uid, met: false, problem: wait.problem, title: wait.title, planUid: wait.planUid, planTitle: wait.planTitle, words: wait.words };
      }
      const dep = within(uid);
      const elsewhere = dep && dep.planUid !== plan.uid;
      return {
        uid, met: true, problem: null,
        title: dep?.title ?? null,
        planUid: dep?.planUid ?? null,
        planTitle: elsewhere ? sources.planTitle(dep.planUid) : null,
        words: null,
      };
    });
    return {
      uid: item.uid,
      parentUid: item.parentUid ?? null,
      kind: item.kind,
      title: item.title,
      status: item.kind === 'action' ? (item.status ?? 'pending') : null,
      assignee: item.assignee ?? null,
      assigneeType: item.assigneeType ?? null,
      assigneeSession: item.assigneeSession ?? null,
      workstream: resolveSection(item, within)?.branch ?? null,
      ticketKey: sources.itemTicketKey(item.uid),
      files: filesOf(item),
      dependencies,
      waits: state.met ? null : waitSentence(item.title, state),
      reads: item.kind === 'action' ? (sources.readsOf?.(item.uid) ?? []) : [],
    };
  });

  return {
    uid: plan.uid,
    title: plan.title,
    status: plan.status,
    ticketKey,
    label: ticketKey ?? plan.title,
    progress: { done: actions.filter((a) => a.status === 'done').length, total: actions.length },
    needsYou: sources.waitingHits(plan.uid),
    tasks,
    overlaps: [],
    arrival: sources.arrivalOf?.(plan.uid) ?? null,
  };
}

// Reached at call time, not spread at load: plan-item-service is part of an
// import cycle through the MCP tools, and is not initialised yet when this
// module loads.
const sources: StackSources = {
  getItem: (uid) => dependencyLookup.getItem(uid),
  planTitle: (planUid) => dependencyLookup.planTitle(planUid),
  planTicketKey: (planUid) => getPlanExternalRefs(planUid).find((r) => r.externalKey)?.externalKey ?? null,
  itemTicketKey: (itemUid) => getExternalRefs(itemUid).find((r) => r.externalKey)?.externalKey ?? null,
  waitingHits: (planUid) => listHits({ state: 'waiting', planUid }).length,
  readsOf: (itemUid) => readsFromDb(itemUid),
  materialsOn: (itemUids) => materialsFromDb(itemUids),
  arrivalOf: (planUid) => { const a = getPlanArrival(planUid); return a ? arrivalWords(a) : null; },
};

const canon = (p: string): string => {
  if (p.startsWith('branch:') || p.startsWith(TASK_PREFIX)) return p;
  try { return fs.realpathSync.native(p); } catch { return p; }
};

/** The worktree root each branch is checked out at, as signals name workstreams. */
function branchRoots(projectPath: string): (branch: string) => string {
  let worktrees: ReturnType<typeof listWorktrees> = [];
  try { worktrees = listWorktrees(projectPath); } catch { /* not a git repository */ }
  return (branch) => worktrees.find((w) => w.branch === branch)?.path ?? `branch:${branch}`;
}

type OverlapSignal = Parameters<typeof stackOverlaps>[1][number];

/** Rows for `plans`, with where each meets another: the one assembly the live stack and the stack at a moment share. */
function assemble(
  projectPath: string,
  plans: Array<Pick<Plan, 'uid' | 'title' | 'status'>>,
  itemsOf: (planUid: string) => PlanItem[],
  from: StackSources,
  signals: readonly OverlapSignal[],
  when: 'now' | 'then',
): Stack {
  const rootOf = branchRoots(projectPath);
  const rows: StackPlan[] = [];
  const footprints: PlanFootprint[] = [];
  for (const plan of plans) {
    const items = itemsOf(plan.uid);
    const row = stackPlanOf(plan, items, from);
    rows.push(row);
    const branches = [...new Set(row.tasks.map((t) => t.workstream).filter((b): b is string => !!b))];
    // A material signal names tasks, not folders (A6.1), so each task is a root too.
    const tasks = items.filter((i) => i.kind === 'action').map((i) => taskWorkstreamId(i.uid));
    // What the unfinished tasks' briefs list: their own materials and their plan's pages'.
    const briefItems = items.filter((i) => i.kind === 'object' || (i.kind === 'action' && !isSettled(i))).map((i) => i.uid);
    const hasOpenTask = items.some((i) => i.kind === 'action' && !isSettled(i));
    const materials = new Set(hasOpenTask ? (from.materialsOn?.(briefItems) ?? []) : []);
    footprints.push({ uid: row.uid, label: row.label, ...declaredFootprint(items), roots: [...branches.map(rootOf), ...tasks], materials });
  }
  const overlaps = stackOverlaps(footprints, signals, canon, when);
  for (const row of rows) row.overlaps = overlaps.get(row.uid) ?? [];
  return { project: projectPath, plans: rows };
}

/** Every active plan in `projectPath`, in the plan list's order, with where each meets another (B6.3). */
export function buildStack(projectPath: string): Stack {
  const plans = listPlans(projectPath).filter((p) => !DONE.has(p.status));
  let signals: ReturnType<typeof loadSignals> = [];
  try { signals = loadSignals(projectPath); } catch { /* awareness not started for this project */ }
  return assemble(projectPath, plans, listAllItems, sources, signals, 'now');
}

/** A plan as it was at a moment, and its items as they were then (from replay-state's `itemsAt`). */
export interface PlanThen {
  plan: Pick<Plan, 'uid' | 'title' | 'status'>;
  items: PlanItem[];
}

/**
 * Phase 32 B6.5 — the stack at a moment: the same rows, built from each
 * item as it was then (who was on it, its branch, what it waited on, its
 * status), with the signals open then and what was waiting on a person
 * then. Ticket keys are today's: a key is a name, not a state.
 */
export function stackThen(
  projectPath: string,
  plans: PlanThen[],
  signalsThen: readonly OverlapSignal[],
  waitingThen: ReadonlyArray<{ planUid: string | null }>,
  /** The moment, for what tasks had read and briefs listed by then (HD3). */
  at?: number,
): Stack {
  const byUid = new Map<string, PlanItem>();
  for (const p of plans) for (const i of p.items) byUid.set(i.uid, i);
  const titles = new Map(plans.map((p) => [p.plan.uid, p.plan.title]));
  const itemsOf = new Map(plans.map((p) => [p.plan.uid, p.items]));
  const then: StackSources = {
    // A task made later did not exist then, so a dependency on it reads as missing.
    getItem: (uid) => byUid.get(uid) ?? null,
    planTitle: (planUid) => titles.get(planUid) ?? null,
    planTicketKey: sources.planTicketKey,
    itemTicketKey: sources.itemTicketKey,
    waitingHits: (planUid) => waitingThen.filter((h) => h.planUid === planUid).length,
    readsOf: (itemUid) => readsFromDb(itemUid, at),
    materialsOn: (itemUids) => materialsFromDb(itemUids, at),
    arrivalOf: sources.arrivalOf,
  };
  return assemble(projectPath, plans.map((p) => p.plan), (uid) => itemsOf.get(uid) ?? [], then, signalsThen, 'then');
}
