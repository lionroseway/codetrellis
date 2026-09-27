/**
 * A change to a project's freeze, in words (Phase 32 §0.4k).
 *
 * Shared by the desktop's freeze bar and the phone, so both say the same thing
 * about the same change — as `budget-words.ts` does for budgets.
 */

/** The parts of a freeze a person decides on. */
export interface FreezeSettings {
  active: boolean;
  reason: string | null;
  /** ISO timestamp, or null for no end. */
  until: string | null;
  allowedPlanUids: string[];
}

/** "2026-10-03 17:00 UTC" — unambiguous on any device, whatever its time zone. */
export function formatUntil(iso: string): string {
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return iso;
  return `${new Date(t).toISOString().slice(0, 16).replace('T', ' ')} UTC`;
}

const plans = (n: number) => `${n} plan${n === 1 ? '' : 's'}`;

export function describeFreezeChange(before: FreezeSettings | null, after: FreezeSettings): string {
  const wasActive = Boolean(before?.active);
  const parts: string[] = [];

  if (!wasActive && after.active) {
    let s = 'froze the project';
    if (after.reason) s += ` ("${after.reason}")`;
    s += after.until ? ` until ${formatUntil(after.until)}` : ' with no end';
    parts.push(s);
  } else if (wasActive && !after.active) {
    parts.push('lifted the freeze');
  } else if (after.active) {
    if ((before?.reason ?? null) !== after.reason) {
      parts.push(after.reason ? `changed the reason to "${after.reason}"` : 'removed the reason');
    }
    if ((before?.until ?? null) !== after.until) {
      parts.push(after.until ? `moved the end to ${formatUntil(after.until)}` : 'removed the end date');
    }
  }

  const had = new Set(before?.allowedPlanUids ?? []);
  const has = new Set(after.allowedPlanUids);
  const added = [...has].filter((u) => !had.has(u)).length;
  const removed = [...had].filter((u) => !has.has(u)).length;
  if (added) parts.push(`exempted ${plans(added)}`);
  // Lifting clears the list, and an exemption from no freeze means nothing.
  if (removed && after.active) parts.push(`removed the exemption for ${plans(removed)}`);

  return parts.join(', ') || 'changed the freeze';
}
