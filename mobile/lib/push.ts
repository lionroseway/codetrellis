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
import { Platform } from 'react-native';
import { webrtc } from './webrtc';

// --- Configuration -----------------------------------------------------------

// Handle notifications when the app is in the foreground
Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowAlert: true,
    shouldPlaySound: true,
    shouldSetBadge: true,
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

    // Set Android notification channel
    if (Platform.OS === 'android') {
      await Notifications.setNotificationChannelAsync('default', {
        name: 'CodeTrellis',
        importance: Notifications.AndroidImportance.HIGH,
        vibrationPattern: [0, 250, 250, 250],
        lightColor: '#3b82f6',
      });
    }

    const tokenData = await Notifications.getExpoPushTokenAsync({
      projectId: 'codetrellis', // Must match app.json slug
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
 * Listen for notification taps (user tapped a push notification).
 * Returns the event data from the notification payload, or null.
 */
export function onNotificationTap(
  handler: (data: { eventId?: string; planSlug?: string }) => void,
): () => void {
  const subscription = Notifications.addNotificationResponseReceivedListener(
    (response) => {
      const data = response.notification.request.content.data as Record<string, unknown>;
      handler({
        eventId: data?.eventId as string | undefined,
        planSlug: data?.planSlug as string | undefined,
      });
    },
  );

  return () => subscription.remove();
}

/**
 * Get the notification that launched the app (if any).
 * Used for deep-linking when the app is opened from a notification.
 */
export async function getInitialNotification(): Promise<{
  eventId?: string;
  planSlug?: string;
} | null> {
  const response = await Notifications.getLastNotificationResponseAsync();
  if (!response) return null;

  const data = response.notification.request.content.data as Record<string, unknown>;
  return {
    eventId: data?.eventId as string | undefined,
    planSlug: data?.planSlug as string | undefined,
  };
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
