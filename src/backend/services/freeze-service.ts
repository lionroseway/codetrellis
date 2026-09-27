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
import { getDb } from './database';
import { markDirty } from './persistence';
import { isFlaggedActor, type BudgetChangeBy } from './budget-service';
import type { FreezeSettings } from '../../shared/lib/freeze-words';

/** Who changed a freeze, and how the change arrived — as for budgets (0.4g). */
export type FreezeChangeBy = BudgetChangeBy;

export interface FreezeChange extends FreezeChangeBy {
  id: number;
  projectPath: string;
  /** Null when the project had never been frozen. */
  before: FreezeSettings | null;
  after: FreezeSettings;
  at: number;
  /** An agent's change, not yet acknowledged by a person. */
  flagged: boolean;
  acknowledgedAt: number | null;
  acknowledgedBy: string | null;
}

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
  /**
   * An agent's changes to the freeze that no person has acknowledged, oldest
   * first (owner's decision, Phase 32 §0.4k). Present whether or not the
   * freeze is active: an agent lifting it is the change most worth seeing.
   */
  flaggedChanges: FreezeChange[];
}

// --- Public API --------------------------------------------------------------

/**
 * Get the current freeze status for a project. Handles auto-expiry:
 * if the `until` timestamp has passed, the freeze is treated as
 * inactive (but not cleared from config — the team can see it happened).
 */
export function getFreezeStatus(projectRoot: string): FreezeStatus {
  return { ...freezeState(projectRoot), flaggedChanges: flaggedFreezeChanges(projectRoot) };
}

function freezeState(projectRoot: string): Omit<FreezeStatus, 'flaggedChanges'> {
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
  /** Who is changing it. Recorded with the settings before and after. */
  by?: FreezeChangeBy,
): FreezeStatus {
  const before = currentSettings(projectRoot);
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
  recordFreezeChange(projectRoot, before, by);
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
export function exemptPlanFromFreeze(projectRoot: string, planUid: string, by?: FreezeChangeBy): FreezeStatus {
  const before = currentSettings(projectRoot);
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
  recordFreezeChange(projectRoot, before, by);
  return getFreezeStatus(projectRoot);
}

// --- Who changed it (owner's decision, Phase 32 §0.4k) -----------------------

/** The settings a person cares about, as stored — null when never frozen. */
function currentSettings(projectRoot: string): FreezeSettings | null {
  const freeze = (getProjectConfig(projectRoot) as any).freeze as FreezeConfig | undefined;
  if (!freeze) return null;
  return {
    active: Boolean(freeze.active),
    reason: freeze.reason ?? null,
    until: freeze.until ?? null,
    allowedPlanUids: [...(freeze.allowedPlanUids ?? [])],
  };
}

const sameSettings = (a: FreezeSettings | null, b: FreezeSettings | null): boolean =>
  JSON.stringify(a) === JSON.stringify(b);

/**
 * Not frozen. A lifted freeze with no reason is stripped from the config
 * file entirely, so "no freeze section" means this, not "nothing happened".
 */
const NOT_FROZEN: FreezeSettings = { active: false, reason: null, until: null, allowedPlanUids: [] };

/** Record a change, when there was one and we know who made it. */
function recordFreezeChange(projectRoot: string, before: FreezeSettings | null, by?: FreezeChangeBy): void {
  if (!by) return;
  const after = currentSettings(projectRoot) ?? NOT_FROZEN;
  if (sameSettings(before ?? NOT_FROZEN, after)) return;
  try {
    getDb().run(
      `INSERT INTO project_freeze_changes (project_path, actor, actor_type, channel, before_json, after_json, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [projectRoot, by.actor, by.actorType, by.channel, before ? JSON.stringify(before) : null, JSON.stringify(after), Date.now()],
    );
    markDirty();
  } catch (err) {
    console.warn('[Freeze] could not record the change:', err);
  }
}

const CHANGE_COLUMNS = 'id, project_path, actor, actor_type, channel, before_json, after_json, created_at, acknowledged_at, acknowledged_by';

function toChange(r: unknown[]): FreezeChange {
  const actorType = r[3] as string;
  const acknowledgedAt = (r[8] as number | null) ?? null;
  return {
    id: r[0] as number,
    projectPath: r[1] as string,
    actor: r[2] as string,
    actorType,
    channel: r[4] as FreezeChange['channel'],
    before: r[5] ? JSON.parse(r[5] as string) : null,
    after: JSON.parse(r[6] as string),
    at: r[7] as number,
    flagged: isFlaggedActor(actorType) && acknowledgedAt === null,
    acknowledgedAt,
    acknowledgedBy: (r[9] as string | null) ?? null,
  };
}

/** Every recorded change to a project's freeze, newest first. */
export function listFreezeChanges(projectRoot: string, limit = 50): FreezeChange[] {
  try {
    const res = getDb().exec(
      `SELECT ${CHANGE_COLUMNS} FROM project_freeze_changes WHERE project_path = ? ORDER BY created_at DESC, id DESC LIMIT ?`,
      [projectRoot, limit],
    );
    return (res[0]?.values ?? []).map(toChange);
  } catch {
    return [];
  }
}

/** An agent's changes no person has acknowledged, oldest first. */
export function flaggedFreezeChanges(projectRoot: string): FreezeChange[] {
  return listFreezeChanges(projectRoot, 500).filter((c) => c.flagged).reverse();
}

/**
 * A person has seen an agent's change. Returns the change, or null when the
 * project has no such change. Acknowledging again changes nothing.
 */
export function acknowledgeFreezeChange(projectRoot: string, id: number, by: string): FreezeChange | null {
  const db = getDb();
  db.run(
    `UPDATE project_freeze_changes SET acknowledged_at = ?, acknowledged_by = ?
     WHERE project_path = ? AND id = ? AND acknowledged_at IS NULL`,
    [Date.now(), by, projectRoot, id],
  );
  markDirty();
  const res = db.exec(`SELECT ${CHANGE_COLUMNS} FROM project_freeze_changes WHERE project_path = ? AND id = ?`, [projectRoot, id]);
  const row = res[0]?.values[0];
  return row ? toChange(row) : null;
}
