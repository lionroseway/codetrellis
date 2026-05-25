/**
 * Freeze-period service — Phase 6.5 of the CDev target architecture.
 *
 * A governance primitive: mark a project as frozen for non-critical work
 * during a defined period (release week, incident response, etc.).
 *
 * Freeze state lives in `.codetrellis/config.json` under a `freeze`
 * section. It is committed and reviewable like any other config. MCP
 * tools allow agents and humans to set/clear freezes and query status.
 *
 * When a freeze is active, agents that attempt to claim or start work
 * on non-exempt plans get a warning surfaced through the channel
 * routing rules (toast + optional webhook).
 */

import {
  getProjectConfig,
  updateProjectConfig,
} from './project-config-service';

import type { FreezeConfig } from '../../shared/types';

export interface FreezeStatus {
  active: boolean;
  reason: string | null;
  since: string | null;
  until: string | null;
  expired: boolean;
  allowedPlanUids: string[];
  /** How long the freeze has been active, in ms. Null when inactive. */
  elapsedMs: number | null;
  /** How long until the freeze expires, in ms. Null when indefinite or inactive. */
  remainingMs: number | null;
}

// --- Public API --------------------------------------------------------------

/**
 * Get the current freeze status for a project. Handles auto-expiry:
 * if the `until` timestamp has passed, the freeze is treated as
 * inactive (but not cleared from config — the team can see it happened).
 */
export function getFreezeStatus(projectRoot: string): FreezeStatus {
  const cfg = getProjectConfig(projectRoot);
  const freeze = (cfg as any).freeze as FreezeConfig | undefined;

  if (!freeze || !freeze.active) {
    return {
      active: false,
      reason: freeze?.reason ?? null,
      since: freeze?.since ?? null,
      until: freeze?.until ?? null,
      expired: false,
      allowedPlanUids: freeze?.allowedPlanUids ?? [],
      elapsedMs: null,
      remainingMs: null,
    };
  }

  const now = Date.now();
  const sinceMs = freeze.since ? new Date(freeze.since).getTime() : null;
  const untilMs = freeze.until ? new Date(freeze.until).getTime() : null;

  const expired = untilMs !== null && now > untilMs;

  return {
    active: !expired,
    reason: freeze.reason ?? null,
    since: freeze.since ?? null,
    until: freeze.until ?? null,
    expired,
    allowedPlanUids: freeze.allowedPlanUids ?? [],
    elapsedMs: sinceMs ? now - sinceMs : null,
    remainingMs: untilMs && !expired ? untilMs - now : null,
  };
}

/**
 * Set or update a freeze on the project. Setting `active: false`
 * lifts the freeze but preserves the record.
 */
export function setFreeze(
  projectRoot: string,
  opts: {
    active: boolean;
    reason?: string;
    until?: string | null;
    allowedPlanUids?: string[];
  },
): FreezeStatus {
  const patch: any = {
    freeze: {
      active: opts.active,
      reason: opts.reason,
      since: opts.active ? new Date().toISOString() : undefined,
      until: opts.until ?? null,
      allowedPlanUids: opts.allowedPlanUids ?? [],
    },
  };

  // If deactivating, preserve the existing 'since' for the record
  if (!opts.active) {
    const cfg = getProjectConfig(projectRoot);
    const existing = (cfg as any).freeze as FreezeConfig | undefined;
    patch.freeze.since = existing?.since ?? undefined;
  }

  updateProjectConfig(projectRoot, patch);
  return getFreezeStatus(projectRoot);
}

/**
 * Check whether a specific plan is allowed during an active freeze.
 * Returns true if: no freeze is active, the freeze has expired, or
 * the plan UID is in the allowed list.
 */
export function isPlanAllowedDuringFreeze(projectRoot: string, planUid: string): boolean {
  const status = getFreezeStatus(projectRoot);
  if (!status.active) return true;
  return status.allowedPlanUids.includes(planUid);
}

/**
 * Add a plan UID to the freeze exemption list without changing the
 * active state.
 */
export function exemptPlanFromFreeze(projectRoot: string, planUid: string): FreezeStatus {
  const cfg = getProjectConfig(projectRoot);
  const freeze = (cfg as any).freeze as FreezeConfig | undefined;
  const current = freeze?.allowedPlanUids ?? [];

  if (current.includes(planUid)) {
    return getFreezeStatus(projectRoot);
  }

  const patch: any = {
    freeze: {
      ...(freeze ?? { active: false }),
      allowedPlanUids: [...current, planUid],
    },
  };

  updateProjectConfig(projectRoot, patch);
  return getFreezeStatus(projectRoot);
}
