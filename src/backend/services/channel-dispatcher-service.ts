/**
 * Channel notification dispatcher — Phase 2.3 of the CDev target architecture.
 *
 * Listens (via direct call from channel-tools / REST handlers) to channel
 * event posts and status changes. For each event:
 *
 *   1. Resolve the project root from the plan's projectPath.
 *   2. Match the event against the project's routing rules
 *      (project-config-service.matchChannelRoutingRules).
 *   3. For each matched rule, fire the configured notification target:
 *      - webhook → POST JSON to the URL (with simple retry on 5xx)
 *      - in-app-toast → broadcast `channel-toast-elevated` so the
 *        frontend's toast surface can render the rule's tone/sticky
 *
 * A separate timer (startStaleEventSweep) periodically scans open
 * events and fires rules with `minAgeMs` once that age has elapsed.
 *
 * Already-fired (ruleId + eventUid) pairs are tracked in-memory so the
 * timer doesn't double-fire. Persistence across restarts is a v2
 * concern.
 */

import { listChannelEvents } from './channel-event-service';
import { matchChannelRoutingRules, listChannelRoutingRules } from './project-config-service';
import { getPlan } from './plan-service';
import { pushForChannelEvent } from './push-notification-service';
import type { BroadcastFn } from '../mcp/types';
import type { ChannelEvent, ChannelRoutingRule } from '../../shared/types';

// --- State ----------------------------------------------------------------

let broadcastFn: BroadcastFn | null = null;
let staleSweepTimer: NodeJS.Timeout | null = null;
const firedNotifications = new Set<string>();

/**
 * Wire the dispatcher up at backend boot. The broadcast function comes
 * from server.ts (the existing WS broadcast). Idempotent.
 */
export function startChannelDispatcher(broadcast: BroadcastFn): void {
  broadcastFn = broadcast;
  if (staleSweepTimer) return;
  // 30s cadence — same rhythm as the session sweep. Cheap (a single
  // DB query per project; most projects have zero rules).
  staleSweepTimer = setInterval(() => {
    sweepStaleEvents().catch((err) => console.warn('[ChannelDispatcher] stale sweep failed:', err));
  }, 30_000);
  if (typeof staleSweepTimer.unref === 'function') staleSweepTimer.unref();
}

/** Stop the dispatcher timer. Test teardown only. */
export function stopChannelDispatcher(): void {
  if (staleSweepTimer) {
    clearInterval(staleSweepTimer);
    staleSweepTimer = null;
  }
  firedNotifications.clear();
}

// --- Post-time dispatch ---------------------------------------------------

/**
 * Called immediately after a channel event is posted or its status
 * changes. Fires every rule whose `when` clause matches and which
 * doesn't require `minAgeMs` (those are handled by the sweep).
 */
export async function dispatchChannelEvent(event: ChannelEvent): Promise<void> {
  // Push notification to mobile devices (Phase 11)
  pushForChannelEvent(event).catch((err) =>
    console.warn('[ChannelDispatcher] push notification failed:', err),
  );

  const projectRoot = projectRootForEvent(event);
  if (!projectRoot) return;
  const rules = matchChannelRoutingRules(projectRoot, event);
  await Promise.all(
    rules
      .filter((r) => r.when.minAgeMs === undefined)
      .map((r) => fireRule(r, event)),
  );
}

/**
 * Periodic sweep that fires rules with `minAgeMs` once the event's
 * age has passed the threshold. Runs every 30s; only `open` events
 * are eligible (resolving/dismissing closes the rule's intent).
 */
async function sweepStaleEvents(): Promise<void> {
  // Gather every plan with routing rules that have minAgeMs.
  // Cheap path for projects with no rules: nothing to do.
  // We iterate plans rather than scanning every channel_event row.
  const eligiblePlans = listEligiblePlansForSweep();
  if (eligiblePlans.length === 0) return;

  const now = Date.now();
  for (const { planUid, projectRoot, rules } of eligiblePlans) {
    const openEvents = listChannelEvents(planUid, { status: 'open', limit: 500 });
    for (const event of openEvents) {
      for (const rule of rules) {
        if (rule.when.minAgeMs === undefined) continue;
        if (!matchesWithoutAge(rule, event)) continue;
        const age = now - event.createdAt;
        if (age < rule.when.minAgeMs) continue;
        const key = notificationKey(rule, event);
        if (firedNotifications.has(key)) continue;
        firedNotifications.add(key);
        await fireRule(rule, event, projectRoot);
      }
    }
  }
}

// --- Rule firing ----------------------------------------------------------

async function fireRule(rule: ChannelRoutingRule, event: ChannelEvent, projectRootHint?: string): Promise<void> {
  try {
    if (rule.notify.target === 'webhook') {
      await fireWebhook(rule, event);
    } else if (rule.notify.target === 'in-app-toast') {
      fireToast(rule, event, projectRootHint);
    }
  } catch (err) {
    console.warn(`[ChannelDispatcher] rule ${rule.id ?? '(unnamed)'} failed:`, err);
  }
}

async function fireWebhook(rule: ChannelRoutingRule, event: ChannelEvent): Promise<void> {
  if (rule.notify.target !== 'webhook') return;
  const url = rule.notify.url;
  const payload = {
    rule: { id: rule.id, description: rule.description },
    event: {
      uid: event.uid,
      planUid: event.planUid,
      itemUid: event.itemUid,
      eventType: event.eventType,
      status: event.status,
      author: event.author,
      authorType: event.authorType,
      agentModel: event.agentModel,
      respondsTo: event.respondsTo,
      payload: event.payload,
      createdAt: event.createdAt,
      updatedAt: event.updatedAt,
    },
    firedAt: new Date().toISOString(),
  };

  const headers = {
    'content-type': 'application/json',
    ...(rule.notify.headers ?? {}),
  };

  // Retry once on 5xx; client errors are not retried.
  const maxAttempts = 2;
  let lastErr: unknown = null;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 5_000);
      try {
        const res = await fetch(url, {
          method: 'POST',
          headers,
          body: JSON.stringify(payload),
          signal: controller.signal,
        });
        if (res.ok) return;
        if (res.status < 500) {
          // Client error — don't retry.
          console.warn(`[ChannelDispatcher] webhook ${url} returned ${res.status} (no retry)`);
          return;
        }
        lastErr = new Error(`HTTP ${res.status}`);
      } finally {
        clearTimeout(timeout);
      }
    } catch (err) {
      lastErr = err;
    }
    if (attempt < maxAttempts) {
      await new Promise((r) => setTimeout(r, 500 * attempt));
    }
  }
  console.warn(`[ChannelDispatcher] webhook ${url} failed after ${maxAttempts} attempts:`, lastErr);
}

function fireToast(rule: ChannelRoutingRule, event: ChannelEvent, projectRootHint?: string): void {
  if (!broadcastFn) return;
  if (rule.notify.target !== 'in-app-toast') return;
  broadcastFn('channel-toast-elevated', {
    ruleId: rule.id ?? null,
    description: rule.description ?? null,
    tone: rule.notify.tone ?? 'info',
    sticky: !!rule.notify.sticky,
    projectRoot: projectRootHint ?? projectRootForEvent(event),
    event: {
      uid: event.uid,
      planUid: event.planUid,
      itemUid: event.itemUid,
      eventType: event.eventType,
      status: event.status,
      // Attribution must travel with the toast payload — the frontend
      // composes the fallback title as "<eventType> · <author>" when
      // the rule has no description. Without these the title falls
      // back to the bland "Channel: stuck" every time.
      author: event.author,
      authorType: event.authorType,
      agentModel: event.agentModel,
      payload: event.payload,
    },
  });
}

// --- Helpers --------------------------------------------------------------

function projectRootForEvent(event: ChannelEvent): string | null {
  const plan = getPlan(event.planUid);
  if (!plan) return null;
  return plan.projectPath || null;
}

function matchesWithoutAge(rule: ChannelRoutingRule, event: ChannelEvent): boolean {
  const w = rule.when;
  if (w.eventType && w.eventType !== event.eventType) return false;
  if (w.status && w.status !== event.status) return false;
  if (w.planUid && w.planUid !== event.planUid) return false;
  if (w.itemUid && w.itemUid !== event.itemUid) return false;
  return true;
}

function notificationKey(rule: ChannelRoutingRule, event: ChannelEvent): string {
  return `${rule.id ?? '_'}:${event.uid}`;
}

/**
 * Find every (plan, projectRoot, rules-with-minAgeMs) tuple the sweep
 * should consider. Hits the DB for every plan; the call is bounded by
 * how many plans exist with channel events, which is small in practice.
 */
function listEligiblePlansForSweep(): Array<{ planUid: string; projectRoot: string; rules: ChannelRoutingRule[] }> {
  // Lazy require to avoid circular import at load time.
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { listPlans } = require('./plan-service');
  const plans: Array<{ uid: string; projectPath: string }> = listPlans();
  const result: Array<{ planUid: string; projectRoot: string; rules: ChannelRoutingRule[] }> = [];
  const cache = new Map<string, ChannelRoutingRule[]>();
  for (const plan of plans) {
    if (!plan.projectPath) continue;
    let rules = cache.get(plan.projectPath);
    if (!rules) {
      rules = listChannelRoutingRules(plan.projectPath).filter((r) => r.when.minAgeMs !== undefined);
      cache.set(plan.projectPath, rules);
    }
    if (rules.length > 0) {
      result.push({ planUid: plan.uid, projectRoot: plan.projectPath, rules });
    }
  }
  return result;
}
