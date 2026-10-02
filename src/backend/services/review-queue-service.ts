/**
 * The review queue (Phase 32 A5.4, awareness spec §9.2): every line of work
 * with plan items in it, keyed by (plan, branch), with what a reviewer needs
 * to decide what to merge next, and a suggested order with its reason.
 *
 * For each line, its branch is reviewed against the main checkout's branch
 * with the existing review (`reviewPlan`, which carries A5.1's dependency
 * edges and A5.2's "Other work in flight"):
 *  - where its items' criteria stand (Phase 31);
 *  - its blast radius and the dependencies nobody planned;
 *  - its open overlaps, and the high ones among them;
 *  - whether it is ready: criteria met, none sent back, no open high overlap.
 * The order comes from the live contract overlaps: a line that changes
 * something another imports goes first (`merge-order.ts`). Never enforced.
 */

import fs from 'node:fs';
import { listPlans } from './plan-service';
import { listAllItems } from './plan-item-service';
import { reviewPlan, type CriteriaSummary } from './plan-review-service';
import { listWorktrees } from './worktree-service';
import { loadSignals } from './awareness-service';
import { isSafeGitRef } from './git-safety';
import { mergeOrder, type OrderDependency } from '../../shared/lib/merge-order';
import type { ReviewQueue, ReviewQueueLine, ReviewQueueStatus } from '../../shared/types/review';

export type { ReviewQueue, ReviewQueueLine, ReviewQueueStatus } from '../../shared/types/review';

const DONE: ReadonlySet<string> = new Set(['completed', 'archived']);

const canon = (p: string): string => {
  if (p.startsWith('branch:')) return p;
  try { return fs.realpathSync.native(p); } catch { return p; }
};

function statusOf(c: CriteriaSummary, openHigh: number): { status: ReviewQueueStatus; statusWords: string } {
  if (openHigh > 0) return { status: 'held', statusWords: `A high overlap with other work is still open${openHigh > 1 ? ` (${openHigh})` : ''}.` };
  if (c.sentBack > 0) return { status: 'in-progress', statusWords: `${c.sentBack} ${c.sentBack === 1 ? 'criterion was' : 'criteria were'} sent back.` };
  if (c.met === c.total) return { status: 'ready', statusWords: c.total ? 'Every criterion is met and nothing high overlaps.' : 'No criteria, and nothing high overlaps.' };
  if (c.met + c.waiting === c.total) return { status: 'waiting', statusWords: `${c.waiting} ${c.waiting === 1 ? 'criterion is' : 'criteria are'} waiting for sign-off.` };
  return { status: 'in-progress', statusWords: `${c.met} of ${c.total} criteria met.` };
}

export function reviewQueue(projectRoot: string): ReviewQueue {
  let worktrees: ReturnType<typeof listWorktrees> = [];
  try { worktrees = listWorktrees(projectRoot); } catch { /* not a git repository */ }
  const main = worktrees.find((w) => w.isMain);
  const base = main?.branch ?? main?.head ?? null;
  const rootOf = (branch: string) => worktrees.find((w) => w.branch === branch)?.path ?? `branch:${branch}`;

  type Draft = Omit<ReviewQueueLine, 'position' | 'reason'>;
  const drafts: Draft[] = [];
  for (const plan of listPlans(projectRoot)) {
    if (DONE.has(plan.status)) continue;
    const items = listAllItems(plan.uid);
    const branches = [...new Set(items.map((i) => i.workstream).filter((b): b is string => !!b && b !== main?.branch))];
    for (const branch of branches) {
      const mine = items.filter((i) => i.workstream === branch);
      const empty: Draft = {
        planUid: plan.uid, planTitle: plan.title, branch, workstream: rootOf(branch), items: mine.length,
        criteria: { total: 0, met: 0, waiting: 0, sentBack: 0 }, filesChanged: 0, blastRadius: 0, unplannedEdges: 0,
        openSignals: 0, openHigh: 0, ready: false, status: 'unavailable', statusWords: '',
      };
      if (!base || !isSafeGitRef(branch) || !isSafeGitRef(base)) {
        drafts.push({ ...empty, statusWords: 'Could not be reviewed: no branch to compare with.', error: 'no base branch' });
        continue;
      }
      const r = reviewPlan({ planUid: plan.uid, projectPath: projectRoot, before: `commit:${base}`, after: `commit:${branch}` });
      if (!r.ok) {
        drafts.push({ ...empty, statusWords: `Could not be reviewed: ${r.error}`, error: r.error });
        continue;
      }
      const uids = new Set(mine.map((i) => i.uid));
      const criteria = r.review.items.filter((i) => uids.has(i.uid)).reduce<CriteriaSummary>((acc, i) => ({
        total: acc.total + i.criteria.total, met: acc.met + i.criteria.met,
        waiting: acc.waiting + i.criteria.waiting, sentBack: acc.sentBack + i.criteria.sentBack,
      }), { total: 0, met: 0, waiting: 0, sentBack: 0 });
      const entries = r.review.otherWork?.entries ?? [];
      const openHigh = r.review.otherWork?.openHigh ?? 0;
      const s = statusOf(criteria, openHigh);
      drafts.push({
        ...empty,
        criteria,
        filesChanged: r.review.summary.filesChanged,
        blastRadius: r.review.comparison.diff.blastRadius.length,
        unplannedEdges: r.review.summary.unplannedEdgeCount,
        openSignals: entries.filter((e) => e.outcome === 'open').length,
        openHigh,
        ready: s.status === 'ready',
        ...s,
      });
    }
  }

  // The live contract overlaps say who must go first: `by` changed it, the
  // other side imports it. An answered one still means the importer must
  // update, so only a fixed one no longer orders anything.
  const keyOf = (d: Draft) => `${d.planUid}\0${d.branch}`;
  const linesAt = (root: string) => drafts.filter((d) => canon(d.workstream) === canon(root));
  const deps: OrderDependency[] = [];
  let signals: ReturnType<typeof loadSignals> = [];
  try { signals = loadSignals(projectRoot); } catch { /* awareness not started for this project */ }
  for (const s of signals) {
    if (s.kind !== 'contract' || s.state === 'resolved' || !s.subject.by) continue;
    for (const first of linesAt(s.subject.by)) {
      for (const root of s.workstreams.filter((w) => canon(w) !== canon(s.subject.by!))) {
        for (const then of linesAt(root)) deps.push({ first: keyOf(first), then: keyOf(then), symbol: s.subject.symbol ?? 'an export' });
      }
    }
  }

  const order = mergeOrder(drafts.map((d) => ({ key: keyOf(d), name: d.branch, ready: d.ready })), deps);
  const byKey = new Map(drafts.map((d) => [keyOf(d), d]));
  return {
    base,
    lines: order.map((o) => ({ ...byKey.get(o.key)!, position: o.position, reason: o.reason })),
  };
}
