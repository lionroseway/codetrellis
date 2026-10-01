import type { RecurrenceRule } from './recurring';
/**
 * Per-project configuration — Phase 1.1 of the CDev target architecture
 * (see `docs/cdev/14-configuration-and-personal-continuity.md` and
 * `docs/cdev/IMPLEMENTATION.md`).
 *
 * Lives at `<projectRoot>/.codetrellis/config.json`. Committed to the
 * manifest like any other plan/item file so the team's agreed
 * conventions travel with the project.
 *
 * Every field is optional. The override resolution rule is
 * **per-item > per-project > per-user**. An absent field means
 * "fall through to the user setting" (`AppSettings`).
 *
 * Schema is intentionally narrow at first; it grows as features land
 * (channels routing, sensor sensitivity, documentation policy, etc.).
 * New fields ADD only — never rename or remove existing keys, so older
 * config files keep parsing cleanly.
 */

import type { DefaultPlanVisibility, AttachmentLocation } from './settings';
import type { ChannelEventStatus, ChannelEventType } from './channel';

export interface ProjectPlansConfig {
  /**
   * Per-project override for the default visibility of newly-created
   * plans. When absent, falls through to the per-user setting.
   */
  defaultVisibility?: DefaultPlanVisibility;
  /**
   * Per-project override for where binary attachments (images, videos)
   * are stored. When absent, falls through to the per-user setting.
   */
  attachmentLocation?: AttachmentLocation;
  /**
   * Phase 32 C3.4a — where this project's plans live when not in the
   * project itself: a planning repository, by its remote, or a folder a
   * sync client carries, by its place under the provider's root. Never a
   * full path: every teammate's copy sits somewhere else. Each device's copy
   * is confirmed by its person before anything there is read.
   */
  folder?: PlansFolderRef;
}

export type PlansFolderProvider = 'onedrive' | 'sharepoint' | 'folder';

export type PlansFolderRef =
  | { kind: 'git'; remote: string }
  | { kind: 'synced'; provider: PlansFolderProvider; place: string };

// --- Channels routing (Phase 2.2) ------------------------------------------

/**
 * A `when` clause: every field is an additional filter. A rule fires
 * when **all** present fields match the event. Absent fields are
 * wildcards.
 *
 * Rules match the event's **current** state, so a rule with just
 * `{ eventType: 'stuck' }` will fire on the initial post *and* on
 * every status change (resolve, dismiss) — the eventType doesn't
 * change. To fire only on the initial post, include
 * `status: 'open'`; to fire only when a stuck is resolved, use
 * `status: 'resolved'`.
 */
export interface ChannelRouteWhen {
  /** Match only events of this type (e.g., 'stuck'). */
  eventType?: ChannelEventType;
  /** Match only events in this status (e.g., 'open'). */
  status?: ChannelEventStatus;
  /** Scope to a specific plan UID. */
  planUid?: string;
  /** Scope to events anchored at a specific item. */
  itemUid?: string;
  /**
   * Stale-event nudge: don't fire until the event has been open for
   * this many milliseconds without resolution. Implemented by the
   * dispatcher's timer loop, not the post-time evaluator.
   */
  minAgeMs?: number;
}

/** An in-app toast notification — escalates the existing broadcast. */
export interface ChannelRouteToastTarget {
  target: 'in-app-toast';
  tone?: 'info' | 'warning' | 'error';
  /** Bypass the auto-dismiss timer and require manual close. */
  sticky?: boolean;
}

/** A webhook POST — JSON payload to a user-configured URL. */
export interface ChannelRouteWebhookTarget {
  target: 'webhook';
  url: string;
  /** Custom HTTP headers (e.g., for auth tokens). Method is always POST in v1. */
  headers?: Record<string, string>;
}

export type ChannelRouteTarget = ChannelRouteToastTarget | ChannelRouteWebhookTarget;

export interface ChannelRoutingRule {
  /** Optional id for the rule — used in logs and disable/enable later. */
  id?: string;
  /** Free-text description for human readers of the config file. */
  description?: string;
  /** Filter clause; absent fields are wildcards. */
  when: ChannelRouteWhen;
  /** Target to notify when this rule fires. */
  notify: ChannelRouteTarget;
  /** When false, the rule is parsed but not evaluated. Useful for staging. */
  enabled?: boolean;
}

export interface ProjectChannelsConfig {
  /**
   * Routing rules evaluated server-side on each channel-event-posted /
   * status-changed broadcast. Rules fire in array order; multiple
   * rules can match the same event.
   */
  routing?: ChannelRoutingRule[];
}

/**
 * Phase 3.6 — repo role hint for the central-oversight deployment
 * shape.
 *
 * In a multi-repo setup, one repo can act as the *planning* hub (it
 * holds the canonical plan manifests; its own code is minimal or
 * non-existent) while sibling *code* repos carry pointer files back
 * to the plans they participate in. A code repo with `repoRole:
 * "code"` would otherwise nag the user with "no plans here yet" — the
 * hint suppresses that nudge and points the UI at the planning repo's
 * stitched view instead.
 *
 * Absent / "mixed" preserves the historical behaviour (both plans
 * and code authored here).
 */
export type ProjectRepoRole = 'planning' | 'code' | 'mixed';

/**
 * Phase 31 §10.1 — where opening this folder lands. A folder of documents
 * opens in the Brief; a codebase on the graph (the default, never stored)
 * or in the code reader. Separate from `repoRole`, which keeps its meaning.
 */
export type ProjectDefaultSurface = 'graph' | 'code' | 'brief';

// --- Sensor configuration (Phase 4.1) ----------------------------------------

/** Drift sensor — auto-fires when files change outside the plan. */
export interface DriftSensorConfig {
  /** Enable drift detection + channel bridging. Default: true. */
  enabled?: boolean;
  /** Auto-post need-decision channel events on new deviations. Default: true. */
  channelEvents?: boolean;
  /** Batch deviations arriving within this window (ms). Default: 2000. */
  debounceMs?: number;
}

/** Documentation sensor — auto-fires when referenced files change. */
export interface DocSensorConfig {
  /** Enable doc-staleness detection + channel bridging. Default: true. */
  enabled?: boolean;
  /** Auto-post need-decision channel events when a doc goes stale. Default: true. */
  channelEvents?: boolean;
}

/** Stuck sensor — detects agents looping without progress. */
export interface StuckSensorConfig {
  /** Enable stuck detection. Default: false (needs calibration). */
  enabled?: boolean;
  /** Same tool called N+ times consecutively with low arg variation. Default: 8. */
  repetitionThreshold?: number;
  /** Same tool errors N+ times in last 10 calls. Default: 5. */
  errorLoopThreshold?: number;
  /** No file change in M minutes while tools are active. Default: 15. */
  idleMinutes?: number;
}

/** Phase 32 — awareness of parallel work. */
export interface AwarenessSensorConfig {
  /**
   * A branch with no checkout on this machine counts as a workstream when
   * its last commit is this recent. Default: 7.
   */
  branchWindowDays?: number;
  /**
   * Tell an agent about an unseen high or medium signal for its workstream by
   * appending a short notice to its next tool result, once per signal
   * (A2.6, awareness spec §6.2). Default: true.
   */
  inlineNotices?: boolean;
  /**
   * A `code` criterion fails while the plan's workstream has an open high
   * overlap with other work, so sign-off waits the way it would for a
   * failing test (A5.3, awareness spec §9.2). Awareness never blocks a tool
   * call; this is the one mechanical check, and it is opt-in. Default: false.
   */
  holdSignOffOnHighSignals?: boolean;
}

export interface SensorConfig {
  drift?: DriftSensorConfig;
  docs?: DocSensorConfig;
  stuck?: StuckSensorConfig;
  awareness?: AwarenessSensorConfig;
}

// --- Sensor defaults (used by getEffectiveSensorConfig) ----------------------

export const SENSOR_DEFAULTS = {
  drift: { enabled: true, channelEvents: true, debounceMs: 2000 },
  docs: { enabled: true, channelEvents: true },
  stuck: { enabled: false, repetitionThreshold: 8, errorLoopThreshold: 5, idleMinutes: 15 },
  awareness: { branchWindowDays: 7, inlineNotices: true, holdSignOffOnHighSignals: false },
} as const;

/** Phase 6.5 — freeze-period governance. */
export interface FreezeConfig {
  /** Whether the freeze is currently active. */
  active: boolean;
  /** Human-readable reason (e.g., "Release v2.3 freeze"). */
  reason?: string;
  /** ISO timestamp when the freeze started. */
  since?: string;
  /** ISO timestamp when the freeze ends (auto-expires). Null = indefinite. */
  until?: string | null;
  /** Plan UIDs exempt from the freeze (can still be worked on). */
  allowedPlanUids?: string[];
}

export interface ProjectConfig {
  plans?: ProjectPlansConfig;
  channels?: ProjectChannelsConfig;
  /** Phase 4.1 — per-project sensor configuration. */
  sensors?: SensorConfig;
  /**
   * Phase 3.6 — hint about this repo's role in a multi-repo setup.
   * UI-only signal; nothing is gated on it. See ProjectRepoRole.
   */
  repoRole?: ProjectRepoRole;
  /** Phase 31 §10.1 — where opening this folder lands. Absent = the graph. */
  defaultSurface?: ProjectDefaultSurface;
  /** Phase 6.5 — freeze-period governance. */
  freeze?: FreezeConfig;
  /** Phase 32 C4 — recurring playbooks, kept here so the team sees them. */
  recurring?: RecurrenceRule[];
  /** ISO timestamp of last save. Updated automatically. */
  updatedAt?: string;
}

/**
 * What a freshly-initialised project config looks like. Empty by
 * design — projects opt in to overrides explicitly.
 */
export const EMPTY_PROJECT_CONFIG: ProjectConfig = {};
