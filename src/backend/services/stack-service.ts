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
import type { Stack, StackDependency, StackPlan, StackTask } from '../../shared/types/stack';
import { listPlans } from './plan-service';
import { listAllItems, dependencyLookup } from './plan-item-service';
import { dependencyState, waitSentence, type DependencyLookup } from './plan-dependencies';
import { resolveSection } from './section-workstreams';
import { getPlanExternalRefs } from './external-intake-service';
import { getExternalRefs } from './external-refs-service';
import { listHits } from './breakpoint-service';
import { listWorktrees } from './worktree-service';
import { loadSignals } from './awareness-service';
import { declaredFootprint, stackOverlaps, type PlanFootprint } from './stack-overlaps';
import fs from 'node:fs';

const DONE: ReadonlySet<string> = new Set(['completed', 'archived']);

export interface StackSources extends DependencyLookup {
  planTicketKey(planUid: string): string | null;
  itemTicketKey(itemUid: string): string | null;
  waitingHits(planUid: string): number;
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
      workstream: resolveSection(item, within)?.branch ?? null,
      ticketKey: sources.itemTicketKey(item.uid),
      files: filesOf(item),
      dependencies,
      waits: state.met ? null : waitSentence(item.title, state),
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
};

const canon = (p: string): string => {
  if (p.startsWith('branch:')) return p;
  try { return fs.realpathSync.native(p); } catch { return p; }
};

/** Every active plan in `projectPath`, in the plan list's order, with where each meets another (B6.3). */
export function buildStack(projectPath: string): Stack {
  const plans = listPlans(projectPath).filter((p) => !DONE.has(p.status));
  let worktrees: ReturnType<typeof listWorktrees> = [];
  try { worktrees = listWorktrees(projectPath); } catch { /* not a git repository */ }
  const rootOf = (branch: string) => worktrees.find((w) => w.branch === branch)?.path ?? `branch:${branch}`;

  const rows: StackPlan[] = [];
  const footprints: PlanFootprint[] = [];
  for (const plan of plans) {
    const items = listAllItems(plan.uid);
    const row = stackPlanOf(plan, items, sources);
    rows.push(row);
    const branches = [...new Set(row.tasks.map((t) => t.workstream).filter((b): b is string => !!b))];
    footprints.push({ uid: row.uid, label: row.label, ...declaredFootprint(items), roots: branches.map(rootOf) });
  }

  let signals: ReturnType<typeof loadSignals> = [];
  try { signals = loadSignals(projectPath); } catch { /* awareness not started for this project */ }
  const overlaps = stackOverlaps(footprints, signals, canon);
  for (const row of rows) row.overlaps = overlaps.get(row.uid) ?? [];
  return { project: projectPath, plans: rows };
}

