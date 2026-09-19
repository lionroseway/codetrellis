import { execFileSync } from 'node:child_process';
import { assertSafeGitRef } from './git-safety';
import { getPlan } from './plan-service';
import { listAllItems } from './plan-item-service';
import { getPlanExternalRefs } from './external-intake-service';
import { getExternalRefs } from './external-refs-service';
import { reviewPlan, renderReviewMarkdown } from './plan-review-service';

/**
 * PR drafts — Phase 25.
 *
 * See [docs/PHASE-25-REVIEW-AND-PLAYBACK.md](../../../docs/PHASE-25-REVIEW-AND-PLAYBACK.md).
 *
 * ## Why this is read-only
 *
 * The design sketched "one action produces a branch, a commit and a PR".
 * Building it made a better split obvious: **CodeTrellis supplies what
 * only it knows, and the agent does the git.**
 *
 * An agent is already fluent with git — branching and committing are its
 * native tools, and it can see the working tree we can only infer.
 * Meanwhile the plan, the ticket lineage, the drift and the
 * architectural delta exist nowhere else. So this produces the *body* an
 * agent could not write, and leaves the mechanics to the thing that is
 * good at them.
 *
 * It also means nothing here mutates a repository. A tool that silently
 * branched and committed on a developer's working tree would be a poor
 * trade for saving an agent three commands it already knows.
 *
 * The result is a payload the agent posts with its own GitHub
 * credentials. CodeTrellis holds none — the same rule as Phase 24.
 */

export interface PrDraft {
  title: string;
  body: string;
  /** Current branch, when we can read it. */
  head: string | null;
  /** The branch this would target. Best-effort. */
  base: string | null;
  /** Ticket keys the plan carries, for the PR title / links. */
  tickets: string[];
  /** Populated when the review found something a reviewer should see. */
  warnings: string[];
}

function git(projectPath: string, args: string[]): string | null {
  try {
    return execFileSync('git', args, { cwd: projectPath, encoding: 'utf-8' }).trim();
  } catch {
    return null;
  }
}

function currentBranch(projectPath: string): string | null {
  const branch = git(projectPath, ['rev-parse', '--abbrev-ref', 'HEAD']);
  return branch && branch !== 'HEAD' ? branch : null;
}

/**
 * The repository's default branch, best-effort.
 *
 * `origin/HEAD` is the honest answer when it is set. When it is not —
 * common on a fresh clone — we fall back to whichever of the usual names
 * actually exists, and to null rather than guessing "main" at a repo
 * that uses something else.
 */
function defaultBranch(projectPath: string): string | null {
  const symbolic = git(projectPath, ['symbolic-ref', '--quiet', 'refs/remotes/origin/HEAD']);
  if (symbolic) return symbolic.replace('refs/remotes/origin/', '');

  for (const candidate of ['main', 'master', 'develop']) {
    if (git(projectPath, ['rev-parse', '--verify', '--quiet', candidate])) return candidate;
  }
  return null;
}

/**
 * Build the PR body for a plan.
 *
 * Sections, in the order a reviewer needs them:
 *   1. what the plan set out to do
 *   2. the tickets it came from, if any
 *   3. the review — what landed, what did not, and what changed that
 *      nobody asked for
 *
 * An agent-authored PR is usually worst at exactly (1) and (3), which is
 * why they lead.
 */
export function buildPrDraft(params: {
  planUid: string;
  projectPath: string;
  before?: string;
  after?: string;
}): { ok: true; draft: PrDraft } | { ok: false; error: string } {
  const plan = getPlan(params.planUid);
  if (!plan) return { ok: false, error: `Plan ${params.planUid} not found` };

  // Only a commit spec carries a git ref. SAFE_REF forbids colons by design,
  // so validating every `before` rejected `checkpoint:1` and `baseline` — the
  // two comparands that are not refs at all — and threw out of a function whose
  // every other failure returns { ok: false }. "Copy PR description" was a
  // silent no-op against a checkpoint, with a 500 behind it.
  if (params.before?.startsWith('commit:')) {
    try {
      assertSafeGitRef(params.before.slice('commit:'.length), 'PR draft base');
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) };
    }
  }

  const items = listAllItems(params.planUid);
  const planRefs = getPlanExternalRefs(params.planUid);
  const itemRefs = items.flatMap((i) => getExternalRefs(i.uid));

  // No casts. `externalKey` is on `ExternalRef` now, so if a SELECT ever
  // drops the column again the compiler says so — the `as` that used to
  // be here is exactly what let the field go unread for a whole phase
  // while `create_plan_from_external` dutifully wrote it.
  const tickets = [
    ...planRefs.map((r) => r.externalKey),
    ...itemRefs.map((r) => r.externalKey),
  ].filter((k): k is string => !!k);
  const uniqueTickets = [...new Set(tickets)];

  const lines: string[] = [];

  const description = (plan as { description?: string }).description?.trim();
  if (description) {
    lines.push('## What this does', '', description, '');
  }

  // Gated on having REFS, not on having parsed keys from them. A
  // Notion page or a Slack thread has no `PROJ-412` in it and is still
  // the lineage a reviewer wants; keying the section on the key list
  // dropped the whole thing, URLs included.
  if (planRefs.length + itemRefs.length > 0) {
    lines.push('## Tickets', '');
    for (const ref of planRefs) {
      lines.push(`- ${ref.externalKey ? `**${ref.externalKey}**` : ref.title} — ${ref.url}`);
    }
    for (const ref of itemRefs) {
      lines.push(`- ${ref.externalKey ? ref.externalKey : ref.title} — ${ref.url}`);
    }
    lines.push('');
  }

  const warnings: string[] = [];
  const review = reviewPlan({
    planUid: params.planUid,
    projectPath: params.projectPath,
    before: params.before,
    after: params.after,
  });

  if (review.ok) {
    lines.push(renderReviewMarkdown(review.review));
    if (review.review.summary.unclaimedCount > 0) {
      warnings.push(
        `${review.review.summary.unclaimedCount} changed file(s) are not claimed by any plan item.`,
      );
    }
    if (review.review.summary.unplannedEdgeCount > 0) {
      warnings.push(
        `${review.review.summary.unplannedEdgeCount} new dependency/ies appeared that no item planned.`,
      );
    }
    if (review.review.summary.itemsPartial > 0) {
      warnings.push(`${review.review.summary.itemsPartial} item(s) only partially landed.`);
    }
  } else {
    // Say so rather than shipping a PR body that quietly omits the half
    // a reviewer most needs.
    lines.push('> The plan review could not be computed for this range: ' + review.error);
  }

  const titleTicket = uniqueTickets.length > 0 ? `${uniqueTickets[0]}: ` : '';

  return {
    ok: true,
    draft: {
      title: `${titleTicket}${plan.title}`,
      body: lines.join('\n').trim(),
      head: currentBranch(params.projectPath),
      base: defaultBranch(params.projectPath),
      tickets: uniqueTickets,
      warnings,
    },
  };
}
