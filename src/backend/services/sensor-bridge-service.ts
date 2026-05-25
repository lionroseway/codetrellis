/**
 * Sensor bridge — Phase 4.2+ of the CDev target architecture.
 *
 * Converts internal detection events (deviations, doc staleness, stuck
 * heuristics) into channel events, so the team-coordination surface
 * surfaces them alongside human-posted events.
 *
 * Design principles:
 *  - Non-obtrusive: every sensor defaults to quiet; channel events are
 *    informational, never hard interrupts.
 *  - Debounced: rapid-fire detections batch into a single channel event
 *    so the timeline isn't noisy.
 *  - Configurable: sensor config in ProjectConfig controls on/off and
 *    thresholds. See getEffectiveSensorConfig.
 *
 * The bridge does NOT import from mcp/ or tools/. It talks to services
 * only, avoiding circular deps.
 */

import { postChannelEvent, type PostChannelEventInput } from './channel-event-service';
import { exportChannelEvent } from './channel-event-file-service';
import { getPlan } from './plan-service';
import { getLinkedPlanDir } from './plan-file-service';
import { getEffectiveSensorConfig } from './project-config-service';
import { dispatchChannelEvent } from './channel-dispatcher-service';
import type { Deviation, ChannelEvent } from '../../shared/types';

// --- Boot-time wiring --------------------------------------------------------

/** Broadcast function injected from server.ts at boot. */
let broadcastFn: ((channel: string, payload: unknown) => void) | null = null;

/**
 * Wire the bridge to the WS broadcast. Called once from server.ts
 * alongside startChannelDispatcher. Idempotent.
 */
export function initSensorBridge(broadcast: (channel: string, payload: unknown) => void): void {
  broadcastFn = broadcast;
}

// --- Shared: post a sensor-authored channel event ----------------------------

/**
 * Post a channel event attributed to a sensor. Handles:
 *  1. DB insert (postChannelEvent)
 *  2. Manifest export (if plan is shared)
 *  3. WS broadcast
 *  4. Channel dispatcher (routing rules → webhook / toast)
 *
 * Returns the created event, or null if posting failed (e.g., plan
 * doesn't exist, channel event validation failed). Failures are
 * logged but never thrown — sensors must never crash the caller.
 */
function postSensorEvent(input: Omit<PostChannelEventInput, 'author' | 'authorType'>): ChannelEvent | null {
  try {
    const event = postChannelEvent({
      ...input,
      author: 'codetrellis',
      authorType: 'sensor',
    });

    // Auto-export to manifest when the plan has a linked dir on disk.
    try {
      const plan = getPlan(event.planUid);
      if (plan) {
        const linkedDir = getLinkedPlanDir(event.planUid, plan.projectPath);
        if (linkedDir) {
          exportChannelEvent(event, plan.projectPath);
        }
      }
    } catch { /* best-effort */ }

    // WS broadcast so the frontend picks it up live.
    if (broadcastFn) {
      broadcastFn('channel-event-posted', {
        uid: event.uid,
        planUid: event.planUid,
        itemUid: event.itemUid,
        eventType: event.eventType,
        respondsTo: event.respondsTo,
        source: 'sensor',
      });
    }

    // Route through the channel dispatcher (webhooks, toasts).
    dispatchChannelEvent(event).catch((err) =>
      console.warn('[SensorBridge] dispatch failed:', err),
    );

    return event;
  } catch (err) {
    console.warn('[SensorBridge] Failed to post sensor event:', err);
    return null;
  }
}

// --- Drift → channel bridge (Phase 4.2) -------------------------------------

/**
 * Per-plan debounce state: accumulated deviations + trailing-edge timer.
 */
interface DriftBatch {
  planUid: string;
  projectRoot: string;
  deviations: Array<{ type: string; file: string | null; description: string }>;
  timer: NodeJS.Timeout;
}

const driftBatches = new Map<string, DriftBatch>();

/**
 * Called from deviation-service whenever a new deviation is created.
 * Checks sensor config, debounces, and eventually posts a single
 * `need-decision` channel event batching all recent deviations.
 *
 * Safe to call from any context (file watcher, MCP tool). Never
 * throws.
 */
export function onDeviationDetected(deviation: Deviation, projectRoot: string): void {
  try {
    const cfg = getEffectiveSensorConfig(projectRoot);
    if (!cfg.drift.enabled || !cfg.drift.channelEvents) return;

    const key = deviation.planUid;
    let batch = driftBatches.get(key);

    if (!batch) {
      batch = {
        planUid: deviation.planUid,
        projectRoot,
        deviations: [],
        timer: setTimeout(() => flushDriftBatch(key), cfg.drift.debounceMs),
      };
      // Ensure the timer doesn't keep the process alive.
      if (typeof batch.timer.unref === 'function') batch.timer.unref();
      driftBatches.set(key, batch);
    }

    batch.deviations.push({
      type: deviation.deviationType,
      file: deviation.filePath,
      description: deviation.description,
    });
  } catch (err) {
    console.warn('[SensorBridge] onDeviationDetected error:', err);
  }
}

function flushDriftBatch(planUid: string): void {
  const batch = driftBatches.get(planUid);
  if (!batch || batch.deviations.length === 0) {
    driftBatches.delete(planUid);
    return;
  }
  driftBatches.delete(planUid);

  const count = batch.deviations.length;
  const fileList = batch.deviations
    .filter((d) => d.file)
    .map((d) => d.file)
    .slice(0, 10); // cap the message length

  const messageParts = [
    `Drift sensor detected ${count} new deviation${count > 1 ? 's' : ''}.`,
  ];
  if (fileList.length > 0) {
    messageParts.push(`Files: ${fileList.join(', ')}${count > 10 ? ` (+${count - 10} more)` : ''}.`);
  }
  messageParts.push('Run `get_drift_report` to review.');

  postSensorEvent({
    planUid: batch.planUid,
    eventType: 'need-decision',
    payload: {
      message: messageParts.join(' '),
      source: 'drift-sensor',
      deviations: batch.deviations,
    },
  });
}

// --- Doc staleness → channel bridge (Phase 4.3) ------------------------------

/**
 * Called when a system doc's freshness transitions to 'stale'. Posts
 * a `need-decision` channel event suggesting the doc be updated or
 * the code change reviewed.
 *
 * `planUid` is optional — if the doc isn't anchored to a specific
 * plan, the event isn't posted (channels are per-plan; a planless
 * doc staleness alert has nowhere to go in the current model).
 */
export function onDocStale(opts: {
  docUid: string;
  slug: string;
  title: string;
  changedFiles: string[];
  planUid: string;
  projectRoot: string;
}): void {
  try {
    const cfg = getEffectiveSensorConfig(opts.projectRoot);
    if (!cfg.docs.enabled || !cfg.docs.channelEvents) return;

    const fileList = opts.changedFiles.slice(0, 5);
    const message = [
      `Doc "${opts.title}" (${opts.slug}) is stale — referenced files changed since last verification.`,
      `Changed: ${fileList.join(', ')}${opts.changedFiles.length > 5 ? ` (+${opts.changedFiles.length - 5} more)` : ''}.`,
      'Verify the doc is still accurate, then run `verify_system_doc` to re-stamp it, or update the doc body to match current code.',
    ].join(' ');

    postSensorEvent({
      planUid: opts.planUid,
      eventType: 'need-decision',
      payload: {
        message,
        source: 'doc-sensor',
        docUid: opts.docUid,
        docSlug: opts.slug,
        changedFiles: opts.changedFiles,
      },
    });
  } catch (err) {
    console.warn('[SensorBridge] onDocStale error:', err);
  }
}

// --- Stuck sensor → channel (Phase 4.4) --------------------------------------

/**
 * Called by the stuck-sensor-service when a heuristic fires. Posts
 * a `stuck` channel event as a soft pause-hint.
 */
export function onStuckDetected(opts: {
  planUid: string;
  sessionId: string;
  heuristic: string;
  description: string;
  projectRoot: string;
}): void {
  try {
    const cfg = getEffectiveSensorConfig(opts.projectRoot);
    if (!cfg.stuck.enabled) return;

    postSensorEvent({
      planUid: opts.planUid,
      eventType: 'stuck',
      payload: {
        message: opts.description,
        source: 'stuck-sensor',
        heuristic: opts.heuristic,
        sessionId: opts.sessionId,
      },
    });
  } catch (err) {
    console.warn('[SensorBridge] onStuckDetected error:', err);
  }
}

// --- Teardown ----------------------------------------------------------------

/** Clear all pending debounce timers. Test teardown. */
export function resetSensorBridge(): void {
  for (const batch of driftBatches.values()) {
    clearTimeout(batch.timer);
  }
  driftBatches.clear();
  broadcastFn = null;
}
