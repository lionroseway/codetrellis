import { listAllItems } from './plan-item-service';
import { projectRelative } from './trusted-roots';
import path from 'node:path';
import { compareSnapshots, listComparands, type ComparisonResult } from './snapshot-compare-service';
import { formatCost } from './pricing';
import { getBudgetReport } from './budget-service';
import type { PlanItem } from '../../shared/types';

/**
 * Review a change against the plan that asked for it — Phase 25.
 *
 * See [docs/PHASE-25-REVIEW-AND-PLAYBACK.md](../../../docs/PHASE-25-REVIEW-AND-PLAYBACK.md).
 *
 * Answers "does this diff do what the plan said?" — and, more usefully,
 * the two questions a human reviewer cannot answer by reading a diff:
 *
 *   - **which changed files no item claimed**, which is the finding
 *     everyone misses on a forty-file agent PR; and
 *   - **which dependencies appeared that nobody planned**, which is
 *     invisible in a textual diff because a new cross-module dependency
 *     is one import line among hundreds.
 *
 * That second one is the reason to build this. A reviewer cannot see
 * "this added a dependency from payments to auth" in a GitHub diff. The
 * graph sees it as a new edge crossing a boundary and can say so in one
 * line.
 */

export interface ReviewedItem {
  uid: string;
  title: string;
  status: string | null;
  /** Declared file targets that changed in this diff. */
  landed: string[];
  /** Declared file targets that did not. */
  missing: string[];
  verdict: 'landed' | 'partial' | 'untouched' | 'no-targets';
}

export interface PlanReview {
  planUid: string;
  comparison: ComparisonResult;
  items: ReviewedItem[];
  /** Changed files that no item's targets cover. The finding. */
  unclaimedChanges: string[];
  /** Edges that appeared without any item planning them. */
  unplannedEdges: Array<{ source: string; target: string }>;
  /** Edges an item planned to remove that are still there. */
  unremovedEdges: Array<{ source: string; target: string }>;
  summary: {
    itemsLanded: number;
    itemsPartial: number;
    itemsUntouched: number;
    filesChanged: number;
    unclaimedCount: number;
    unplannedEdgeCount: number;
  };
}

function normalise(p: string): string {
  return p.replace(/^\.\//, '').replace(/^\/+/, '').toLowerCase();
}

/** A target covers a path when equal, or when it is a parent directory. */
function covers(target: string, changed: string): boolean {
  const t = normalise(target);
  const c = normalise(changed);
  if (!t) return false;
  if (t === c) return true;
  return c.startsWith(t.endsWith('/') ? t : `${t}/`);
}

/**
 * An item's declared file targets, project-relative.
 *
 * The UI writes ABSOLUTE paths into fileSpecs — `/api/scan` returns a file tree
 * built with `path.join(dirPath, entry.name)`, and the mention picker passes
 * that straight through — while a changed file is project-relative. `normalise`
 * only strips a leading slash, so `/Users/me/proj/src/a.ts` became
 * `users/me/proj/src/a.ts` and could never equal `src/a.ts`. Every target
 * declared through the standard route read as untouched, and the absolute path
 * (with the developer's home directory in it) was then printed verbatim into
 * the PR description.
 */
function targetsOf(item: PlanItem, projectPath: string): string[] {
  return (item.fileSpecs ?? [])
    .map((f) => f.path)
    .filter(Boolean)
    .map((t) => (path.isAbsolute(t) ? projectRelative(projectPath, t) || t : t));
}

function edgeKey(source: string, target: string): string {
  return `${normalise(source)}->${normalise(target)}`;
}

/**
 * Review a plan against the change between two points.
 *
 * Defaults to baseline → live, which is "what has happened since I
 * pinned the baseline". Any two comparands work — including a commit
 * range, though a commit contributes files only (see
 * `snapshot-compare-service`), so edge findings need a checkpoint on
 * both sides.
 */
/**
 * What to compare against when the caller does not say.
 *
 * NOT the baseline, and that is the whole point. `scanProject` re-pins the
 * baseline on every run (server.ts, `setBaseline(captureSnapshot(...))`),
 * so the sequence every agent actually follows — edit files, rescan, ask
 * for a review — moved the baseline to the post-edit state and then
 * compared it against itself. The review answered "untouched" for every
 * item on a plan whose work had genuinely landed, silently, with no error
 * to notice.
 *
 * Verified end to end: one file edited, `compare_snapshots` against a
 * checkpoint correctly reported 1 modified, and `review_plan` in the same
 * session reported 0 of 3 landed.
 *
 * The code surface already learned this — `CodeWorkspace` picks its diff
 * base from the comparand list for exactly this reason (m11). The review
 * kept the old default. Same lesson, second surface, which is the shape
 * this codebase keeps repeating.
 *
 * The newest commit is the honest default: it is a point that does not
 * move underneath you. Baseline remains the fallback for a project with no
 * commits, where it is the only thing there is.
 */
function defaultComparand(projectPath: string): string {
  try {
    const newestCommit = listComparands(projectPath, 1).find((c) => c.kind === 'commit');
    if (newestCommit) return newestCommit.spec;
  } catch {
    // Not a git repo, or git is unavailable — baseline is all we have.
  }
  return 'baseline';
}

export function reviewPlan(params: {
  planUid: string;
  projectPath: string;
  before?: string;
  after?: string;
}): { ok: true; review: PlanReview } | { ok: false; error: string } {
  const compared = compareSnapshots(
    params.before ?? defaultComparand(params.projectPath),
    params.after ?? 'live',
    params.projectPath,
  );
  if (!compared.ok) return compared;

  const comparison = compared.result;
  const changedFiles = [
    ...comparison.diff.addedFiles,
    ...comparison.diff.modifiedFiles,
    ...comparison.diff.removedFiles,
  ];

  const items = listAllItems(params.planUid);

  const reviewed: ReviewedItem[] = items.map((item) => {
    const targets = targetsOf(item, params.projectPath);
    if (targets.length === 0) {
      return {
        uid: item.uid,
        title: item.title,
        status: item.status ?? null,
        landed: [],
        missing: [],
        verdict: 'no-targets',
      };
    }

    const landed: string[] = [];
    const missing: string[] = [];
    for (const target of targets) {
      if (changedFiles.some((f) => covers(target, f))) landed.push(target);
      else missing.push(target);
    }

    const verdict: ReviewedItem['verdict'] =
      landed.length === 0 ? 'untouched' : missing.length === 0 ? 'landed' : 'partial';

    return { uid: item.uid, title: item.title, status: item.status ?? null, landed, missing, verdict };
  });

  // Every declared target across the plan, for the unclaimed check.
  const allTargets = items.flatMap((i) => targetsOf(i, params.projectPath));
  const unclaimedChanges = changedFiles.filter((f) => !allTargets.some((t) => covers(t, f)));

  // Planned connections, in both directions.
  const plannedAdds = new Set<string>();
  const plannedRemovals = new Set<string>();
  for (const item of items) {
    for (const c of item.newConnections ?? []) plannedAdds.add(edgeKey(c.from, c.to));
    for (const c of item.removedConnections ?? []) plannedRemovals.add(edgeKey(c.from, c.to));
  }

  // Only meaningful when both sides of the comparison knew their edges;
  // otherwise "no unplanned edges" would be an absence reported as a
  // finding.
  const unplannedEdges = comparison.edgesComparable
    ? comparison.diff.addedEdges.filter((e) => !plannedAdds.has(edgeKey(e.source, e.target)))
    : [];
  const unremovedEdges = comparison.edgesComparable
    ? [...plannedRemovals]
        .filter((key) => !comparison.diff.removedEdges.some((e) => edgeKey(e.source, e.target) === key))
        .map((key) => {
          const [source, target] = key.split('->');
          return { source, target };
        })
    : [];

  return {
    ok: true,
    review: {
      planUid: params.planUid,
      comparison,
      items: reviewed,
      unclaimedChanges,
      unplannedEdges,
      unremovedEdges,
      summary: {
        itemsLanded: reviewed.filter((i) => i.verdict === 'landed').length,
        itemsPartial: reviewed.filter((i) => i.verdict === 'partial').length,
        itemsUntouched: reviewed.filter((i) => i.verdict === 'untouched').length,
        filesChanged: changedFiles.length,
        unclaimedCount: unclaimedChanges.length,
        unplannedEdgeCount: unplannedEdges.length,
      },
    },
  };
}

/**
 * Render a review as markdown, for posting as a PR comment.
 *
 * The markdown form is what gets this in front of people who do not have
 * the app — which is most reviewers, most of the time. A panel only
 * helps the person who already opened CodeTrellis.
 */
export function renderReviewMarkdown(review: PlanReview, planTitle?: string): string {
  const lines: string[] = [];
  const s = review.summary;

  lines.push(`## Plan review${planTitle ? `: ${planTitle}` : ''}`);
  lines.push('');
  lines.push(
    `Comparing **${review.comparison.before.label}** → **${review.comparison.after.label}** ` +
      `· ${s.filesChanged} file${s.filesChanged === 1 ? '' : 's'} changed`,
  );
  lines.push('');

  lines.push(
    `| Landed | Partial | Untouched | Unclaimed files | Unplanned edges |`,
    `|---|---|---|---|---|`,
    `| ${s.itemsLanded} | ${s.itemsPartial} | ${s.itemsUntouched} | ${s.unclaimedCount} | ${s.unplannedEdgeCount} |`,
    '',
  );

  const partial = review.items.filter((i) => i.verdict === 'partial');
  if (partial.length > 0) {
    lines.push('### Partially landed');
    lines.push('');
    for (const item of partial) {
      lines.push(`- **${item.title}** — still missing: ${item.missing.map((m) => `\`${m}\``).join(', ')}`);
    }
    lines.push('');
  }

  if (review.unclaimedChanges.length > 0) {
    lines.push('### Changed, but no item claimed them');
    lines.push('');
    lines.push('The finding a diff cannot show you: these files changed without any plan item asking for it.');
    lines.push('');
    for (const file of review.unclaimedChanges.slice(0, 25)) lines.push(`- \`${file}\``);
    if (review.unclaimedChanges.length > 25) {
      lines.push(`- …and ${review.unclaimedChanges.length - 25} more`);
    }
    lines.push('');
  }

  if (review.unplannedEdges.length > 0) {
    lines.push('### New dependencies nobody planned');
    lines.push('');
    lines.push('Each of these is one import line in the diff, and a new coupling in the architecture.');
    lines.push('');
    for (const edge of review.unplannedEdges.slice(0, 25)) {
      lines.push(`- \`${edge.source}\` → \`${edge.target}\``);
    }
    if (review.unplannedEdges.length > 25) {
      lines.push(`- …and ${review.unplannedEdges.length - 25} more`);
    }
    lines.push('');
  }

  if (review.unremovedEdges.length > 0) {
    lines.push('### Dependencies the plan said to remove, still present');
    lines.push('');
    for (const edge of review.unremovedEdges.slice(0, 25)) {
      lines.push(`- \`${edge.source}\` → \`${edge.target}\``);
    }
    lines.push('');
  }

  if (!review.comparison.edgesComparable) {
    lines.push('> Edges were not compared for this range — see the note below.');
    lines.push('');
  }
  for (const note of review.comparison.notes) lines.push(`> ${note}`);

  // Cost, when we have it. A reviewer asking "was this worth it" is
  // asking a fair question, and the number is already recorded.
  const budget = getBudgetReport(review.planUid);
  if (budget.spentMinutes > 0) {
    lines.push('');
    lines.push(
      `_Spent on this plan: ${budget.spentMinutes.toFixed(0)} minutes` +
        (budget.spentCostUsd === null ? '' : `, ${formatCost(budget.spentCostUsd)}`) +
        '._',
    );
  }

  return lines.join('\n');
}
