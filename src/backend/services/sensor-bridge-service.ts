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

// [codemod] hoisted lazy requires → static namespace imports for bundling
import * as _lazy___system_docs_service from './system-docs-service';
import { postChannelEvent, listChannelEvents, setChannelEventStatus, type PostChannelEventInput } from './channel-event-service';
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

// --- Criteria → channel bridge (Phase 31 §12) ------------------------------

/**
 * A criterion needs a person: an agent submitted work for them to judge,
 * or an approval's files changed since. Posted like every sensor event —
 * broadcast, exported, dispatched — so it reaches a phone as a push, and
 * it names the criterion, so the push opens the approval rather than a
 * list the person then has to search.
 */
export function postCriterionNotice(opts: {
  planUid: string;
  itemUid: string;
  criterionUid: string;
  /** Why a person is needed: work to judge, or an approval whose files changed. */
  reason: 'submitted' | 'stale';
  message: string;
}): ChannelEvent | null {
  return postSensorEvent({
    planUid: opts.planUid,
    itemUid: opts.itemUid,
    eventType: 'need-decision',
    payload: { message: opts.message, criterionUid: opts.criterionUid, reason: opts.reason },
  });
}

/**
 * A person decided: the notices that asked them to are answered. Without
 * this they stay open, and "needs decision" on the phone and desktop keeps
 * counting work nobody is waiting on. Returns how many were resolved.
 */
export function resolveCriterionNotices(planUid: string, criterionUid: string): number {
  let resolved = 0;
  try {
    const open = listChannelEvents(planUid, { eventTypes: ['need-decision'], status: 'open', limit: 500 });
    for (const e of open) {
      if (e.payload?.criterionUid !== criterionUid) continue;
      const updated = setChannelEventStatus(e.uid, 'resolved');
      resolved++;
      try {
        const plan = getPlan(updated.planUid);
        if (plan && getLinkedPlanDir(updated.planUid, plan.projectPath)) exportChannelEvent(updated, plan.projectPath);
      } catch { /* best-effort */ }
      broadcastFn?.('channel-event-status-changed', { uid: updated.uid, planUid: updated.planUid, status: updated.status });
    }
  } catch (err) {
    console.warn('[SensorBridge] Could not resolve criterion notices:', err);
  }
  return resolved;
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

// Track which (docUid, planUid) staleness events we've already posted
// so we don't re-fire on every file-watcher event for the same stale doc.
const firedDocStale = new Set<string>();

/**
 * Called from the file watcher when a source file changes. Cross-
 * references the path against system docs that list it in
 * `references.files`, checks freshness, and posts a `need-decision`
 * channel event for any that have gone stale.
 *
 * Safe to call from the hot file-watcher path — failures are caught
 * and logged, never thrown.
 */
export function checkDocFreshnessForFile(relativePath: string, projectRoot: string): void {
  try {
    const cfg = getEffectiveSensorConfig(projectRoot);
    if (!cfg.docs.enabled || !cfg.docs.channelEvents) return;

    // Lazy-require to avoid circular dep at load time.
    const { findDocsByReferencedFile, getFreshness } = _lazy___system_docs_service;

    const matchingDocs: Array<{ uid: string; slug: string; title: string; plans: string[] }> =
      findDocsByReferencedFile(projectRoot, relativePath);
    if (matchingDocs.length === 0) return;

    for (const doc of matchingDocs) {
      const report = getFreshness(doc.uid);
      if (!report || report.status !== 'stale') continue;

      // Channel events are per-plan. Use the first referenced plan,
      // or skip if the doc has no plan anchor.
      const planUid = doc.plans[0];
      if (!planUid) continue;

      const key = `${doc.uid}:${planUid}`;
      if (firedDocStale.has(key)) continue;
      firedDocStale.add(key);

      postDocStaleEvent({
        docUid: doc.uid,
        slug: doc.slug,
        title: doc.title,
        changedFiles: report.changedReferencedFiles,
        planUid,
        projectRoot,
      });
    }
  } catch (err) {
    console.warn('[SensorBridge] checkDocFreshnessForFile error:', err);
  }
}

/**
 * Check all system docs for a project and post channel events for
 * any that have gone stale. Called from the REST endpoint
 * `/api/sensors/doc-check` (git-hook trigger).
 *
 * `eventsSurfaced` counts stale docs whose staleness has been
 * surfaced to the channel — either by this call or already by the
 * file-watcher path. A git-hook consumer can trust
 * `eventsSurfaced > 0` to mean "the team has been notified."
 */
export function checkAllDocsAndBridge(projectRoot: string): { staleCount: number; eventsSurfaced: number } {
  try {
    const cfg = getEffectiveSensorConfig(projectRoot);
    if (!cfg.docs.enabled || !cfg.docs.channelEvents) return { staleCount: 0, eventsSurfaced: 0 };

    const { checkAllDocsFreshness, getSystemDoc } = _lazy___system_docs_service;
    const staleReports = checkAllDocsFreshness(projectRoot);
    let eventsSurfaced = 0;

    for (const report of staleReports) {
      const doc = getSystemDoc(report.uid);
      if (!doc) continue;
      const planUid = doc.references?.plans?.[0];
      if (!planUid) continue;

      const key = `${doc.uid}:${planUid}`;
      if (firedDocStale.has(key)) {
        // Already surfaced by the file-watcher path — still counts
        // as "team has been notified" for the caller.
        eventsSurfaced++;
        continue;
      }
      firedDocStale.add(key);

      const posted = postDocStaleEvent({
        docUid: doc.uid,
        slug: doc.slug,
        title: doc.title,
        changedFiles: report.changedReferencedFiles,
        planUid,
        projectRoot,
      });
      if (posted) eventsSurfaced++;
    }

    return { staleCount: staleReports.length, eventsSurfaced };
  } catch (err) {
    console.warn('[SensorBridge] checkAllDocsAndBridge error:', err);
    return { staleCount: 0, eventsSurfaced: 0 };
  }
}

/**
 * Internal helper: post a doc-stale channel event.
 */
function postDocStaleEvent(opts: {
  docUid: string;
  slug: string;
  title: string;
  changedFiles: string[];
  planUid: string;
  projectRoot: string;
}): boolean {
  const fileList = opts.changedFiles.slice(0, 5);
  const message = [
    `Doc "${opts.title}" (${opts.slug}) is stale — referenced files changed since last verification.`,
    `Changed: ${fileList.join(', ')}${opts.changedFiles.length > 5 ? ` (+${opts.changedFiles.length - 5} more)` : ''}.`,
    'Verify the doc is still accurate, then run `verify_system_doc` to re-stamp it, or update the doc body to match current code.',
  ].join(' ');

  return !!postSensorEvent({
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

/** Clear all pending debounce timers and caches. Test teardown. */
export function resetSensorBridge(): void {
  for (const batch of driftBatches.values()) {
    clearTimeout(batch.timer);
  }
  driftBatches.clear();
  firedDocStale.clear();
  broadcastFn = null;
}
