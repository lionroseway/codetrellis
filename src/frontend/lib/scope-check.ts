import type { PlanItem } from '@shared/types';

/**
 * In-scope checking — Phase 22, change C.
 *
 * See [docs/PHASE-22-AGENT-ACTIVITY-CLARITY.md](../../../docs/PHASE-22-AGENT-ACTIVITY-CLARITY.md).
 *
 * Answers the question a user actually has while an agent runs: **is it
 * touching what I asked it to touch?**
 *
 * The drift machinery (`deviation-service`, `plan-changes-service`)
 * already computes essentially this, but frames it as an after-the-fact
 * report. The same fact, framed as *right now, files are being changed
 * that nobody planned for*, is the thing worth leaving open on a second
 * monitor — and it is the product's whole thesis made visible.
 *
 * ## Attribution, honestly
 *
 * This is scoped to the **project**, not to an individual agent. Agents
 * write code with their own file tools, not through MCP, so the
 * file-watcher sees the change without knowing who made it. Claiming a
 * per-agent attribution we cannot support would be worse than a true
 * project-level one — and with a single agent connected, which is the
 * common case, they are the same thing.
 */

export type ScopeVerdict = 'clean' | 'in-scope' | 'out-of-scope';

export interface ScopeReport {
  verdict: ScopeVerdict;
  /** Changed files covered by an in-flight item's declared targets. */
  inScope: string[];
  /** Changed files nothing in flight claims. The finding. */
  outOfScope: string[];
  /** Items considered in flight for this check. */
  claimedItems: PlanItem[];
}

/** Statuses that mean "someone is working on this right now". */
const IN_FLIGHT = new Set(['in_progress', 'assigned', 'claimed']);

function normalise(path: string): string {
  return path.replace(/^\.\//, '').replace(/^\/+/, '').toLowerCase();
}

/**
 * A declared target covers a changed file when the paths match, or when
 * the target is a directory containing it. Directory targets are how
 * plans usually express scope ("everything under `auth/`"), so treating
 * them as literal paths would report almost everything as out of scope.
 */
function covers(target: string, changed: string): boolean {
  const t = normalise(target);
  const c = normalise(changed);
  if (!t) return false;
  if (t === c) return true;
  // Directory prefix — with the separator required, so `auth` does not
  // match `authentication.ts`.
  return c.startsWith(t.endsWith('/') ? t : `${t}/`);
}

/**
 * Compare recently changed files against the targets of in-flight items.
 *
 * `clean` means nothing has changed recently — not that everything is
 * fine. The distinction matters: a green badge on an idle project would
 * be a claim we have not checked.
 */
export function checkScope(changedFiles: string[], items: PlanItem[]): ScopeReport {
  const claimedItems = items.filter((i) => IN_FLIGHT.has(String(i.status ?? '')));

  if (changedFiles.length === 0) {
    return { verdict: 'clean', inScope: [], outOfScope: [], claimedItems };
  }

  const targets: string[] = [];
  for (const item of claimedItems) {
    for (const spec of item.fileSpecs ?? []) {
      if (spec?.path) targets.push(spec.path);
    }
  }

  // Nothing in flight declares any target. That is not "out of scope" —
  // it is "no scope was declared", and reporting a violation against an
  // empty plan would be noise that trains people to ignore the badge.
  if (targets.length === 0) {
    return { verdict: 'clean', inScope: [], outOfScope: [], claimedItems };
  }

  const inScope: string[] = [];
  const outOfScope: string[] = [];
  for (const file of changedFiles) {
    if (targets.some((t) => covers(t, file))) inScope.push(file);
    else outOfScope.push(file);
  }

  return {
    verdict: outOfScope.length > 0 ? 'out-of-scope' : 'in-scope',
    inScope,
    outOfScope,
    claimedItems,
  };
}

/** One line for the badge's tooltip / label. */
export function describeScope(report: ScopeReport): string {
  switch (report.verdict) {
    case 'clean':
      return report.claimedItems.length === 0
        ? 'No item in flight'
        : 'No recent changes';
    case 'in-scope':
      return `${report.inScope.length} file${report.inScope.length === 1 ? '' : 's'} changed, all in scope`;
    case 'out-of-scope': {
      const n = report.outOfScope.length;
      return `${n} file${n === 1 ? '' : 's'} changed that no item claims`;
    }
  }
}
