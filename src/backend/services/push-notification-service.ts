/**
 * Push notification service — Phase 11.4 of the CDev target architecture.
 *
 * Sends push notifications to paired mobile devices via the Expo Push API
 * when channel events fire that warrant immediate attention (stuck,
 * need-decision, need-context) and when remote user-input requests arrive.
 *
 * Mobile devices register their Expo Push Token over the WebRTC `control`
 * channel after pairing. Tokens are stored in memory (they're ephemeral —
 * a new token is registered each time the mobile app connects).
 *
 * Privacy: push payloads are minimal (event type + IDs). Full content
 * loads over WebRTC when the app wakes. Expo Push sees only the token
 * and a short message.
 *
 * Rate limit: max 1 push per event type per minute per device.
 */

import type { ChannelEvent } from '../../shared/types';

// --- Types -------------------------------------------------------------------

interface PushToken {
  /** Expo Push Token (e.g. "ExponentPushToken[xxxx]"). */
  token: string;
  /** Fingerprint of the mobile device that registered this token. */
  fingerprint: string;
  /** When the token was registered (epoch ms). */
  registeredAt: number;
}

interface PushPayload {
  to: string;
  title: string;
  body: string;
  data: Record<string, string>;
  sound: 'default';
  badge?: number;
  channelId?: string;
}

// --- State -------------------------------------------------------------------

const pushTokens = new Map<string, PushToken>();

/** Rate limit: `"fingerprint:eventType" → lastSentAt (epoch ms)`. */
const rateLimitMap = new Map<string, number>();

/** Minimum interval between pushes of the same event type to the same device. */
const RATE_LIMIT_MS = 60_000;

/** Expo Push API endpoint. */
const EXPO_PUSH_URL = 'https://exp.host/--/api/v2/push/send';

/** Event types that trigger push notifications. */
const PUSH_WORTHY_EVENTS: ReadonlySet<string> = new Set([
  'stuck',
  'need-decision',
  'need-context',
]);

let started = false;

// --- Public API: Lifecycle ---------------------------------------------------

/**
 * Start the push notification service.
 * Called from peer-connection-service during startup.
 */
export function startPushNotifications(): void {
  if (started) return;
  started = true;
  console.log('[PushNotifications] Started');
}

/**
 * Stop the push notification service.
 */
export function stopPushNotifications(): void {
  if (!started) return;
  started = false;
  pushTokens.clear();
  rateLimitMap.clear();
  console.log('[PushNotifications] Stopped');
}

export function isPushNotificationsRunning(): boolean {
  return started;
}

// --- Public API: Token management --------------------------------------------

/**
 * Register a push token from a mobile device. Called when the mobile
 * sends its Expo Push Token over the `control` channel after connecting.
 */
export function registerPushToken(fingerprint: string, token: string): void {
  pushTokens.set(fingerprint, {
    token,
    fingerprint,
    registeredAt: Date.now(),
  });
  console.log(`[PushNotifications] Registered token for ${fingerprint.slice(0, 12)}...`);
}

/**
 * Remove the push token for a device (e.g. when it disconnects).
 */
export function unregisterPushToken(fingerprint: string): void {
  pushTokens.delete(fingerprint);
}

/**
 * List all registered push tokens.
 */
export function listPushTokens(): PushToken[] {
  return Array.from(pushTokens.values());
}

// --- Public API: Sending notifications ---------------------------------------

/**
 * Send push notifications for a channel event. Called from the same
 * sites that call `dispatchChannelEvent` — the channel tools, REST
 * routes, and sensor bridge.
 *
 * Only fires for push-worthy event types. Rate-limited per device.
 */
export async function pushForChannelEvent(event: ChannelEvent): Promise<void> {
  if (!started) return;
  if (!PUSH_WORTHY_EVENTS.has(event.eventType)) return;

  const tokens = Array.from(pushTokens.values());
  if (tokens.length === 0) return;

  const title = channelEventTitle(event);
  const body = channelEventBody(event);

  const payloads: PushPayload[] = [];
  for (const { token, fingerprint } of tokens) {
    if (isRateLimited(fingerprint, event.eventType)) continue;
    markSent(fingerprint, event.eventType);
    payloads.push({
      to: token,
      title,
      body,
      data: {
        type: 'channel-event',
        eventId: event.uid,
        planUid: event.planUid,
        eventType: event.eventType,
      },
      sound: 'default',
      channelId: 'codetrellis-events',
    });
  }

  if (payloads.length > 0) {
    await sendExpoPush(payloads);
  }
}

/**
 * Send a push notification for a remote user-input request (an agent
 * is waiting for the user to make a decision). Higher priority — always
 * sends regardless of event-type rate limits.
 */
export async function pushForInputRequest(
  prompt: string,
  requestId: string,
  planUid?: string,
): Promise<void> {
  if (!started) return;

  const tokens = Array.from(pushTokens.values());
  if (tokens.length === 0) return;

  const payloads: PushPayload[] = [];
  for (const { token, fingerprint } of tokens) {
    if (isRateLimited(fingerprint, 'input-request')) continue;
    markSent(fingerprint, 'input-request');
    payloads.push({
      to: token,
      title: 'Agent needs your input',
      body: prompt.length > 100 ? prompt.slice(0, 97) + '...' : prompt,
      data: {
        type: 'input-request',
        requestId,
        ...(planUid ? { planUid } : {}),
      },
      sound: 'default',
      channelId: 'codetrellis-events',
    });
  }

  if (payloads.length > 0) {
    await sendExpoPush(payloads);
  }
}

// --- Internals ---------------------------------------------------------------

function channelEventTitle(event: ChannelEvent): string {
  const labels: Record<string, string> = {
    'stuck': 'Agent is stuck',
    'need-decision': 'Decision needed',
    'need-context': 'Context needed',
    'handing-off': 'Handoff',
    'steer': 'Steering input',
    'weigh-in': 'Team input requested',
  };
  return labels[event.eventType] || `Channel: ${event.eventType}`;
}

function channelEventBody(event: ChannelEvent): string {
  const message = event.payload?.message || '(no message)';
  const author = event.author || 'unknown';
  const prefix = `${author}: `;
  const maxLen = 120 - prefix.length;
  const truncated = message.length > maxLen
    ? message.slice(0, maxLen - 3) + '...'
    : message;
  return prefix + truncated;
}

function isRateLimited(fingerprint: string, eventType: string): boolean {
  const key = `${fingerprint}:${eventType}`;
  const lastSent = rateLimitMap.get(key);
  if (!lastSent) return false;
  return Date.now() - lastSent < RATE_LIMIT_MS;
}

function markSent(fingerprint: string, eventType: string): void {
  const key = `${fingerprint}:${eventType}`;
  rateLimitMap.set(key, Date.now());
}

async function sendExpoPush(payloads: PushPayload[]): Promise<void> {
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10_000);
    try {
      const res = await fetch(EXPO_PUSH_URL, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(payloads),
        signal: controller.signal,
      });
      if (!res.ok) {
        console.warn(`[PushNotifications] Expo Push API returned ${res.status}`);
      }
    } finally {
      clearTimeout(timeout);
    }
  } catch (err) {
    console.warn('[PushNotifications] Failed to send push:', err);
  }
}
