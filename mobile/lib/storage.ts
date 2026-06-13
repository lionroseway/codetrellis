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
const MANUAL_DISCONNECT_KEY = 'codetrellis_manual_disconnect';

/**
 * Whether the user *explicitly* disconnected (vs. the app just closing or a
 * transient drop). When set, launch auto-connect is skipped — a deliberate
 * "leave it disconnected" should survive an app restart. Cleared the moment
 * the user taps Connect again.
 */
export async function setManualDisconnect(value: boolean): Promise<void> {
  try {
    await SecureStore.setItemAsync(MANUAL_DISCONNECT_KEY, value ? '1' : '0');
  } catch {
    /* best-effort */
  }
}

export async function getManualDisconnect(): Promise<boolean> {
  try {
    return (await SecureStore.getItemAsync(MANUAL_DISCONNECT_KEY)) === '1';
  } catch {
    return false;
  }
}

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
 * Matches on pairingId first (stable), falls back to fingerprint (ephemeral).
 */
export async function upsertPairedDesktop(device: PairedDesktop): Promise<void> {
  const devices = await loadPairedDesktops();
  // Match by stable pairingId first, then fall back to fingerprint
  let idx = device.pairingId
    ? devices.findIndex((d) => d.pairingId === device.pairingId)
    : -1;
  if (idx < 0) {
    idx = devices.findIndex((d) => d.fingerprint === device.fingerprint);
  }
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
 * Reachability rank for ordering candidate addresses (lower = tried first):
 * regular LAN first, then CGNAT/Tailscale, then anything else. Mirrors the
 * desktop's ordering in pairing-server.getAllAddresses().
 */
function addressRank(ip: string): number {
  if (/^(192\.168\.|10\.|172\.(1[6-9]|2\d|3[01])\.)/.test(ip)) return 0; // LAN
  if (/^100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\./.test(ip)) return 1;     // CGNAT / Tailscale
  return 2;                                                              // other / public
}

/**
 * Merge newly-learned reachable addresses into a paired desktop's
 * `candidateAddresses`, deduped and ordered LAN-first. Returns the merged
 * list (empty if the device isn't found / nothing to merge).
 *
 * Used at pair time (from the QR's `hs[]`) and on every connect (from the
 * desktop snapshot's `deviceAddresses`) so a LAN pairing auto-upgrades to
 * reconnect over a VPN without re-pairing.
 */
export async function mergeCandidateAddresses(
  match: { pairingId?: string; fingerprint?: string },
  addresses: string[],
): Promise<string[]> {
  const incoming = addresses.map((a) => (a || '').trim()).filter(Boolean);
  if (incoming.length === 0) return [];

  const devices = await loadPairedDesktops();
  let idx = match.pairingId
    ? devices.findIndex((d) => d.pairingId === match.pairingId)
    : -1;
  if (idx < 0 && match.fingerprint) {
    idx = devices.findIndex((d) => d.fingerprint === match.fingerprint);
  }
  if (idx < 0) return [];

  const existing = devices[idx].candidateAddresses ?? [];
  const merged = [...new Set([...existing, ...incoming])].sort(
    (a, b) => addressRank(a) - addressRank(b),
  );

  // Only write if it actually changed (avoids churning SecureStore).
  const changed =
    merged.length !== existing.length || merged.some((a, i) => a !== existing[i]);
  if (changed) {
    devices[idx].candidateAddresses = merged;
    await savePairedDesktops(devices);
  }
  return merged;
}

/**
 * Record a successful connection: bumps lastConnected and, when provided,
 * the address that actually worked, the port, and a silently-upgraded
 * pairingId. Updates ONLY the given fields (unlike upsert, it never blanks
 * the alias or other untouched fields). No-op if the device isn't found.
 */
export async function recordConnect(
  match: { pairingId?: string; fingerprint: string },
  fields: { lastKnownAddress?: string; lastKnownPort?: number; pairingId?: string } = {},
): Promise<void> {
  const devices = await loadPairedDesktops();
  let idx = match.pairingId
    ? devices.findIndex((d) => d.pairingId === match.pairingId)
    : -1;
  if (idx < 0) idx = devices.findIndex((d) => d.fingerprint === match.fingerprint);
  if (idx < 0) return;

  const d = devices[idx];
  d.lastConnected = new Date().toISOString();
  if (fields.lastKnownAddress) d.lastKnownAddress = fields.lastKnownAddress;
  if (typeof fields.lastKnownPort === 'number') d.lastKnownPort = fields.lastKnownPort;
  if (fields.pairingId) d.pairingId = fields.pairingId;
  await savePairedDesktops(devices);
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
