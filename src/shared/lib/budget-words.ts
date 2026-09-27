/**
 * A budget in words: durations, costs, and what an agent changed about a
 * plan's ceiling. One copy for the desktop chip and for the phone, which
 * gets these sentences from the backend (budget.get), so both say the
 * same thing about the same change.
 */

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

/** A plan's ceiling at one moment. */
export interface BudgetCeiling { minutes: number | null; costUsd: number | null; exempt: boolean }

/** "raised the time ceiling 2h → 4h, exempted the plan" — what an agent changed, in words. */
export function describeBudgetChange(before: BudgetCeiling | null, after: BudgetCeiling): string {
  const was = before ?? { minutes: null, costUsd: null, exempt: false };
  const parts: string[] = [];
  const dimension = (label: string, from: number | null, to: number | null, fmt: (n: number) => string) => {
    if (from === to) return;
    if (to === null) parts.push(`cleared the ${label} ceiling (was ${fmt(from!)})`);
    else if (from === null) parts.push(`set a ${label} ceiling of ${fmt(to)}`);
    else parts.push(`${to > from ? 'raised' : 'lowered'} the ${label} ceiling ${fmt(from)} → ${fmt(to)}`);
  };
  dimension('time', was.minutes, after.minutes, formatMinutes);
  dimension('cost', was.costUsd, after.costUsd, (n) => formatCost(n));
  if (was.exempt !== after.exempt) parts.push(after.exempt ? 'exempted the plan from its ceiling' : 'ended the exemption');
  return parts.join(', ') || 'changed the budget';
}
