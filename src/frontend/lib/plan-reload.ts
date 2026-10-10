/**
 * Phase 33 S2 — the window takes a burst of plan reloads as one.
 *
 * The backend broadcasts `plan-imported` once per plan per burst (S1), but a
 * pull that touches five plans still sends five, and the window used to
 * refetch and toast for each. The hook gathers them with the shared burst
 * helper and, per burst, refetches once and shows one notice, written here.
 * Pure.
 */

export interface PlanImported {
  planUid?: string;
  source?: string;
  /** How many changed files the import covered (S1); absent from older backends. */
  files?: number;
  warnings?: unknown[];
}

export interface PlanReload {
  /** Every plan reloaded in the burst. */
  planUids: string[];
  title: string;
  message: string;
}

const n = (count: number, one: string, many: string) => `${count} ${count === 1 ? one : many}`;

/** One notice for a burst of `plan-imported` broadcasts from the file watcher. */
export function planReload(burst: readonly PlanImported[]): PlanReload {
  const planUids = [...new Set(burst.map((p) => p.planUid).filter((u): u is string => typeof u === 'string'))];
  const files = burst.reduce((sum, p) => sum + (typeof p.files === 'number' ? p.files : 0), 0);
  const warnings = burst.reduce((sum, p) => sum + (Array.isArray(p.warnings) ? p.warnings.length : 0), 0);

  const title = planUids.length > 1 ? `${planUids.length} plans reloaded from disk` : 'Plan reloaded from disk';
  const parts: string[] = [];
  if (files > 0) parts.push(`${n(files, 'file', 'files')} changed`);
  if (warnings > 0) parts.push(n(warnings, 'warning', 'warnings'));
  const message = parts.length ? `${parts.join(', ')}.` : 'External change picked up.';
  return { planUids, title, message };
}
