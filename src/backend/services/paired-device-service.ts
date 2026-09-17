/**
 * Paired device storage — Phase 9.2 of the CDev target architecture.
 *
 * CRUD for paired devices stored in `~/.codetrellis/paired-devices.json`.
 * A device is "paired" once the QR handshake completes. The shared
 * secret from the DTLS handshake is stored (hex-encoded) for
 * auto-reconnect on subsequent sessions.
 *
 * This is a pure data store — no networking logic. The pairing
 * handshake lives in `pairing-service.ts`; the WebRTC connection
 * lifecycle lives in `peer-connection-service.ts`.
 */

import fs from 'node:fs';
import path from 'node:path';
import type { PairedDevice, PeerCapabilityName } from '../../shared/types';
import { getSettingsDir } from './persistence';
import { ALL_CAPABILITIES, DEFAULT_GRANTS } from './peer-capabilities';
import { recordPeerAudit } from './peer-audit-service';

// --- File path ---------------------------------------------------------------

function getPairedDevicesPath(): string {
  return path.join(getSettingsDir(), 'paired-devices.json');
}

// --- In-memory cache ---------------------------------------------------------

let devices: PairedDevice[] | null = null;

function ensureLoaded(): PairedDevice[] {
  if (devices) return devices;

  const filePath = getPairedDevicesPath();
  if (!fs.existsSync(filePath)) {
    devices = [];
    return devices;
  }

  try {
    const raw = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
    if (Array.isArray(raw)) {
      devices = raw;
    } else {
      console.warn('[PairedDevices] Invalid format — starting fresh');
      devices = [];
    }
  } catch (err) {
    console.warn('[PairedDevices] Failed to read paired-devices.json:', err);
    devices = [];
  }

  return devices;
}

function persist(): void {
  const filePath = getPairedDevicesPath();
  const dir = path.dirname(filePath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }

  try {
    fs.writeFileSync(filePath, JSON.stringify(devices, null, 2), 'utf-8');
  } catch (err) {
    console.error('[PairedDevices] Failed to write paired-devices.json:', err);
  }
}

// --- Public API --------------------------------------------------------------

/**
 * List all paired devices.
 */
export function listPairedDevices(): PairedDevice[] {
  return [...ensureLoaded()];
}

/**
 * Get a paired device by fingerprint.
 */
export function getPairedDevice(fingerprint: string): PairedDevice | undefined {
  return ensureLoaded().find((d) => d.fingerprint === fingerprint);
}

/**
 * Add or update a paired device. If a device with the same fingerprint
 * exists, it is replaced (re-pairing updates the shared secret).
 */
export function upsertPairedDevice(device: PairedDevice): void {
  const list = ensureLoaded();
  const idx = list.findIndex((d) => d.fingerprint === device.fingerprint);
  if (idx >= 0) {
    list[idx] = device;
  } else {
    list.push(device);
  }
  persist();
  console.log(`[PairedDevices] ${idx >= 0 ? 'Updated' : 'Added'} device: ${device.alias} (${device.fingerprint.slice(0, 12)}…)`);
}

/**
 * Remove a paired device by fingerprint.
 * Returns true if the device was found and removed.
 */
export function removePairedDevice(fingerprint: string): boolean {
  const list = ensureLoaded();
  const idx = list.findIndex((d) => d.fingerprint === fingerprint);
  if (idx < 0) return false;

  const removed = list.splice(idx, 1)[0];
  persist();
  console.log(`[PairedDevices] Removed device: ${removed.alias} (${fingerprint.slice(0, 12)}…)`);
  return true;
}

/**
 * Update the `lastConnected` timestamp for a device.
 */
export function touchPairedDevice(fingerprint: string): void {
  const device = ensureLoaded().find((d) => d.fingerprint === fingerprint);
  if (device) {
    device.lastConnected = new Date().toISOString();
    persist();
  }
}

/**
 * Update the alias for a paired device.
 */
export function renamePairedDevice(fingerprint: string, alias: string): boolean {
  const device = ensureLoaded().find((d) => d.fingerprint === fingerprint);
  if (!device) return false;
  device.alias = alias;
  persist();
  return true;
}

/**
 * Associate an mDNS instance ID with a paired device (when a discovered
 * peer's fingerprint matches a stored paired device).
 */
/**
 * Set what a device is allowed to ask this desktop to do.
 *
 * Phase 19, finding 15. Granting `terminal` is granting command execution and
 * the ability to read command output, so it is a decision the user makes per
 * device, explicitly, after pairing — never something that rides along with
 * pairing itself.
 *
 * Every change is written to the audit trail. A capability that was granted
 * for an afternoon and revoked leaves no trace in the device record, and "was
 * this phone ever allowed a shell?" is exactly the question asked later.
 *
 * Unknown capability names are dropped rather than stored: a typo that
 * persisted would look like a grant in the settings UI and deny at runtime,
 * which is the worst of both.
 */
export function setDeviceCapabilities(
  fingerprint: string,
  capabilities: string[],
): PeerCapabilityName[] | null {
  const device = ensureLoaded().find((d) => d.fingerprint === fingerprint);
  if (!device) return null;

  const valid = [...new Set(capabilities)].filter(
    (c): c is PeerCapabilityName => (ALL_CAPABILITIES as readonly string[]).includes(c),
  );

  const before = device.capabilities ?? [...DEFAULT_GRANTS];
  const added = valid.filter((c) => !before.includes(c));
  const removed = before.filter((c) => !valid.includes(c));

  device.capabilities = valid;
  persist();

  if (added.length || removed.length) {
    recordPeerAudit({
      kind: 'capability-change',
      fingerprint,
      alias: device.alias,
      method: 'settings.deviceCapabilities',
      detail: [
        added.length ? `granted ${added.join(', ')}` : '',
        removed.length ? `revoked ${removed.join(', ')}` : '',
      ].filter(Boolean).join('; '),
    });
  }

  return valid;
}

/**
 * Record the certificate a device is currently using.
 *
 * The fingerprint is per-CONNECTION on iOS, not per-install, so the stored
 * value is a recent observation rather than an identity. It is kept only so
 * discovery can associate an mDNS advertisement with a paired device; nothing
 * authenticates against it (see `computeReconnectAnswerMac`).
 */
export function refreshDeviceFingerprint(pairingId: string, fingerprint: string): void {
  const device = ensureLoaded().find((d) => d.pairingId === pairingId);
  if (!device || !fingerprint || device.fingerprint === fingerprint) return;
  device.fingerprint = fingerprint;
  persist();
}

export function linkInstanceId(fingerprint: string, instanceId: string): void {
  const device = ensureLoaded().find((d) => d.fingerprint === fingerprint);
  if (device) {
    device.instanceId = instanceId;
    persist();
  }
}

/**
 * Clear the in-memory cache. Used in tests.
 */
export function _resetCache(): void {
  devices = null;
}
