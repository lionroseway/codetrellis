/**
 * Push notifications — Expo Notifications wrapper.
 *
 * Registers for push notifications and handles incoming notifications
 * (tap → navigate to the relevant event in the workspace).
 *
 * The push token is sent to the desktop over the `control` channel
 * after pairing, so the desktop can send push via the Expo Push API
 * when the app is backgrounded and WebRTC is disconnected.
 */

import * as Notifications from 'expo-notifications';
import Constants from 'expo-constants';
import { Platform } from 'react-native';
import { webrtc } from './webrtc';

// The desktop sends pushes with this Android channel id — it MUST exist on the
// device or Android drops/min-importances the notification. Keep in sync with
// push-notification-service.ts (`channelId: 'codetrellis-events'`).
const ANDROID_CHANNEL_ID = 'codetrellis-events';

// Expo push tokens are scoped to the EAS *project id* (a UUID), not the slug.
// Read it from the app config so it can never drift from app.json.
const EAS_PROJECT_ID =
  (Constants.expoConfig?.extra?.eas?.projectId as string | undefined) ||
  '47be6d4e-2e16-47a9-958d-afb4ebaab412';

// --- Configuration -----------------------------------------------------------

// Handle notifications when the app is in the foreground
Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowAlert: true,
    shouldPlaySound: true,
    shouldSetBadge: true,
    // SDK 52+ split shouldShowAlert into banner + list.
    shouldShowBanner: true,
    shouldShowList: true,
  }),
});

// --- Public API --------------------------------------------------------------

/**
 * Request notification permissions and get the Expo Push Token.
 * Returns null if permissions are denied.
 */
export async function registerForPush(): Promise<string | null> {
  try {
    const { status: existingStatus } = await Notifications.getPermissionsAsync();
    let finalStatus = existingStatus;

    if (existingStatus !== 'granted') {
      const { status } = await Notifications.requestPermissionsAsync();
      finalStatus = status;
    }

    if (finalStatus !== 'granted') {
      console.log('[Push] Permission not granted');
      return null;
    }

    // Create the Android channel the desktop targets (must match the
    // push payload's channelId, or Android won't surface the notification).
    if (Platform.OS === 'android') {
      await Notifications.setNotificationChannelAsync(ANDROID_CHANNEL_ID, {
        name: 'CodeTrellis events',
        importance: Notifications.AndroidImportance.HIGH,
        vibrationPattern: [0, 250, 250, 250],
        lightColor: '#3b82f6',
      });
    }

    const tokenData = await Notifications.getExpoPushTokenAsync({
      projectId: EAS_PROJECT_ID, // EAS project UUID, not the slug
    });

    return tokenData.data;
  } catch (err) {
    console.warn('[Push] Failed to get token:', err);
    return null;
  }
}

/**
 * Send the push token to the connected desktop over the control channel.
 * The desktop stores it and uses the Expo Push API to send notifications
 * when the app is backgrounded.
 */
export function sendPushTokenToDesktop(token: string): boolean {
  return webrtc.sendControl({
    method: 'register-push-token',
    params: { token, platform: Platform.OS },
  });
}

/**
 * Normalized notification payload — matches what the desktop's
 * push-notification-service attaches in `data`.
 */
export interface NotificationData {
  type?: string;       // 'channel-event' | 'input-request' | …
  eventId?: string;    // channel event uid
  planUid?: string;
  requestId?: string;  // input request id
  eventType?: string;
}

function extract(data: Record<string, unknown> | undefined): NotificationData {
  return {
    type: data?.type as string | undefined,
    eventId: data?.eventId as string | undefined,
    planUid: data?.planUid as string | undefined,
    requestId: data?.requestId as string | undefined,
    eventType: data?.eventType as string | undefined,
  };
}

/** Map a notification payload to the Expo Router path it should open, or null. */
export function routeForNotification(d: NotificationData): string | null {
  if (d.type === 'input-request' && d.requestId) {
    return `/input-request?requestId=${encodeURIComponent(d.requestId)}`;
  }
  if (d.type === 'channel-event' && d.eventId) {
    return `/event-detail?uid=${encodeURIComponent(d.eventId)}`;
  }
  if (d.planUid) {
    return `/plan-detail?uid=${encodeURIComponent(d.planUid)}`;
  }
  return null;
}

/**
 * Listen for notification taps. Returns the normalized payload to the handler.
 */
export function onNotificationTap(
  handler: (data: NotificationData) => void,
): () => void {
  const subscription = Notifications.addNotificationResponseReceivedListener(
    (response) => handler(extract(response.notification.request.content.data as Record<string, unknown>)),
  );
  return () => subscription.remove();
}

/**
 * The notification that launched the app from cold start (if any), for
 * deep-linking on open.
 */
export async function getInitialNotification(): Promise<NotificationData | null> {
  const response = await Notifications.getLastNotificationResponseAsync();
  if (!response) return null;
  return extract(response.notification.request.content.data as Record<string, unknown>);
}

/**
 * Set the badge count (unresponded events).
 */
export async function setBadgeCount(count: number): Promise<void> {
  try {
    await Notifications.setBadgeCountAsync(count);
  } catch {
    // Not supported on all platforms
  }
}
