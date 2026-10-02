/**
 * How long the record and the activity around it are kept (Phase 32 B10.2).
 *
 * One window, set by the person in Settings → Data, governs everything kept
 * over time: agent events (and so the record, trimmed as its oldest block so
 * it still verifies), replay snapshots and signal spans, test runs, log
 * files, and the device log. "Everything" keeps all of it; the device log,
 * rewritten whole on each change, still keeps at most `DEVICE_LOG_CAP`.
 */

import { getSettings } from './settings-service';
import type { RetentionDays } from '../../shared/types';

export const DAY_MS = 24 * 60 * 60 * 1000;
export const DEFAULT_RETENTION_DAYS = 14;
/** The device log is one JSON file; past this many entries the oldest go, whatever the window. */
export const DEVICE_LOG_CAP = 10_000;

/** The window in days, or null to keep everything. Never throws: unreadable settings mean the default. */
export function retentionDays(): RetentionDays {
  try {
    return getSettings().data.retentionDays;
  } catch {
    return DEFAULT_RETENTION_DAYS;
  }
}

/** Everything written before this goes, or null when everything is kept. */
export function retentionCutoff(now = Date.now(), days: RetentionDays = retentionDays()): number | null {
  return days === null ? null : now - days * DAY_MS;
}

/** The window in words, for the person and for an agent: "30 days", "everything". */
export function retentionWords(days: RetentionDays = retentionDays()): string {
  if (days === null) return 'everything';
  return days === 365 ? 'a year' : `${days} days`;
}
