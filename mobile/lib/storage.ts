/**
 * Persistent storage — Expo SecureStore wrapper.
 *
 * Stores pairing credentials (fingerprint + shared secret) in the
 * device's secure keychain (iOS Keychain / Android Keystore).
 * The device list and aliases are stored separately from secrets.
 */

import * as SecureStore from 'expo-secure-store';
import type { PairedDesktop } from './types';

const DEVICES_KEY = 'codetrellis_paired_devices';

/**
 * Load all paired desktops from secure storage.
 */
export async function loadPairedDesktops(): Promise<PairedDesktop[]> {
  try {
    const raw = await SecureStore.getItemAsync(DEVICES_KEY);
    if (!raw) return [];
    return JSON.parse(raw) as PairedDesktop[];
  } catch {
    return [];
  }
}

/**
 * Save the paired desktops list to secure storage.
 */
export async function savePairedDesktops(devices: PairedDesktop[]): Promise<void> {
  await SecureStore.setItemAsync(DEVICES_KEY, JSON.stringify(devices));
}

/**
 * Add or update a paired desktop.
 */
export async function upsertPairedDesktop(device: PairedDesktop): Promise<void> {
  const devices = await loadPairedDesktops();
  const idx = devices.findIndex((d) => d.fingerprint === device.fingerprint);
  if (idx >= 0) {
    devices[idx] = { ...devices[idx], ...device };
  } else {
    devices.push(device);
  }
  await savePairedDesktops(devices);
}

/**
 * Remove a paired desktop by fingerprint.
 */
export async function removePairedDesktop(fingerprint: string): Promise<boolean> {
  const devices = await loadPairedDesktops();
  const idx = devices.findIndex((d) => d.fingerprint === fingerprint);
  if (idx < 0) return false;
  devices.splice(idx, 1);
  await savePairedDesktops(devices);
  return true;
}

/**
 * Get a specific paired desktop.
 */
export async function getPairedDesktop(fingerprint: string): Promise<PairedDesktop | null> {
  const devices = await loadPairedDesktops();
  return devices.find((d) => d.fingerprint === fingerprint) ?? null;
}

/**
 * Update the last connected timestamp for a paired desktop.
 */
export async function touchPairedDesktop(fingerprint: string): Promise<void> {
  const devices = await loadPairedDesktops();
  const device = devices.find((d) => d.fingerprint === fingerprint);
  if (device) {
    device.lastConnected = new Date().toISOString();
    await savePairedDesktops(devices);
  }
}
