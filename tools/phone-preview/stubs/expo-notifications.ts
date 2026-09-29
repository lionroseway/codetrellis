/**
 * Push notifications in the preview (Phase 32 A4.5b): the module loads and
 * does nothing, so a test can reach `mobile/lib/push.ts`'s pure routing
 * (which notification tap opens which screen) without a device.
 */

export const AndroidImportance = { HIGH: 4 } as const;
export function setNotificationHandler(): void {}
export async function getPermissionsAsync(): Promise<{ status: string }> { return { status: 'denied' }; }
export async function requestPermissionsAsync(): Promise<{ status: string }> { return { status: 'denied' }; }
export async function setNotificationChannelAsync(): Promise<void> {}
export async function getExpoPushTokenAsync(): Promise<{ data: string }> { return { data: '' }; }
export function addNotificationResponseReceivedListener(): { remove: () => void } { return { remove: () => {} }; }
export async function getLastNotificationResponseAsync(): Promise<null> { return null; }
export async function setBadgeCountAsync(): Promise<boolean> { return true; }
