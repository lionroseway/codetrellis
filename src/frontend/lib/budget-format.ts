/**
 * Formatting and state for the plan budget chip — Phase 29.
 *
 * See [docs/PHASE-29-SURFACING-WHAT-WE-COLLECT.md](../../../docs/PHASE-29-SURFACING-WHAT-WE-COLLECT.md).
 *
 * Extracted from the component so the rules below are testable, because
 * each is a place where the obvious implementation says something false:
 *
 *   - an unknown cost is not zero;
 *   - an unknown cost cannot breach a cost ceiling;
 *   - the worse of the two dimensions decides the state.
 *
 * `stateOf` intentionally mirrors `budgetState` in
 * `services/budget-service.ts`. The duplication is deliberate — the chip
 * renders from a report it already has rather than making a second call
 * for a string — and `WARN_AT` is kept in step by the unit test that
 * asserts the 80% boundary on both sides.
 */

export type BudgetState = 'none' | 'ok' | 'warn' | 'over' | 'exempt';

/** Matches `WARN_AT` in `services/budget-service.ts`. */
export const WARN_AT = 0.8;

export interface BudgetStateInput {
  budget: { minutes: number | null; costUsd: number | null; exempt: boolean } | null;
  spentMinutes: number;
  spentCostUsd: number | null;
}

/**
 * Where a plan stands against its ceiling.
 *
 * Both dimensions are checked and the worse one wins — a plan can be
 * comfortably inside its time budget and well past its cost budget.
 */
export function stateOf(report: BudgetStateInput): BudgetState {
  const b = report.budget;
  if (!b || (b.minutes === null && b.costUsd === null)) return 'none';
  if (b.exempt) return 'exempt';

  const fractions: number[] = [];
  if (b.minutes !== null && b.minutes > 0) fractions.push(report.spentMinutes / b.minutes);
  // An unknown cost cannot breach a cost ceiling. Treating null as zero
  // would report "well within budget" for spend we simply cannot see.
  if (b.costUsd !== null && b.costUsd > 0 && report.spentCostUsd !== null) {
    fractions.push(report.spentCostUsd / b.costUsd);
  }
  if (fractions.length === 0) return 'none';

  const worst = Math.max(...fractions);
  if (worst >= 1) return 'over';
  if (worst >= WARN_AT) return 'warn';
  return 'ok';
}

export function formatMinutes(mins: number): string {
  if (mins < 1) return '<1m';
  if (mins < 60) return `${Math.round(mins)}m`;
  const h = Math.floor(mins / 60);
  const m = Math.round(mins % 60);
  return m === 0 ? `${h}h` : `${h}h ${m}m`;
}

/**
 * Cost, where null means **not reported** and never "$0.00".
 *
 * `spentCostUsd` is null when no agent on the plan reported a model, so
 * nothing could be priced. Rendering that as zero would quietly report a
 * plan as free when the truth is that its cost is invisible to us.
 */
export function formatCost(usd: number | null): string {
  if (usd === null) return 'not reported';
  if (usd < 0.01) return '<$0.01';
  return `$${usd.toFixed(2)}`;
}
