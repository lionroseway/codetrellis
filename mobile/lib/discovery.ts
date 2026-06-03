/**
 * mDNS discovery — browses the local network for CodeTrellis desktops.
 *
 * Uses `react-native-zeroconf` to browse for `_codetrellis._tcp` services
 * advertised by the desktop's mDNS service. Extracts the mobile API port,
 * instance ID, device name, and LAN address from the TXT records.
 *
 * On discovery, updates stored paired desktops with the latest address
 * and port so reconnection works even after DHCP or port changes.
 */

import { upsertPairedDesktop, loadPairedDesktops } from './storage';

// --- Types -------------------------------------------------------------------

export interface DiscoveredDesktop {
  /** mDNS instance ID (ephemeral, changes on restart). */
  instanceId: string;
  /** Human-readable name ("Saif's MacBook Pro"). */
  deviceName: string;
  /** LAN IPv4 address. */
  address: string;
  /** Mobile API port (from TXT record, default 19480). */
  mobileApiPort: number;
  /** DTLS fingerprint (may be "pending" on startup). */
  fingerprint: string;
  /** When this desktop was last seen. */
  lastSeen: Date;
}

// --- State -------------------------------------------------------------------

let zeroconfInstance: any = null;
let browsing = false;
const discovered = new Map<string, DiscoveredDesktop>();
const listeners = new Set<(desktops: DiscoveredDesktop[]) => void>();

// --- Public API --------------------------------------------------------------

/**
 * Start browsing for CodeTrellis desktops on the local network.
 * Safe to call multiple times — restarts cleanly.
 */
export function startDiscovery(): void {
  if (browsing) return;

  try {
    // Lazy-load to avoid crash if native module missing.
    // In Expo Go the JS package loads fine but the native bridge
    // is absent, so *any* call into the native module throws.
    // Wrap the entire setup in one big try/catch.
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const Zeroconf = require('react-native-zeroconf').default;
    if (!Zeroconf) {
      console.warn('[Discovery] react-native-zeroconf default export is null');
      return;
    }
    zeroconfInstance = new Zeroconf();

    if (!zeroconfInstance) {
      console.warn('[Discovery] Zeroconf instance is null');
      return;
    }

    zeroconfInstance.on('resolved', (service: any) => {
      const txt = service.txt ?? {};
      const instanceId = txt.instanceId || service.name || '';
      const deviceName = txt.deviceName || service.name || 'Unknown';
      const fingerprint = txt.fingerprint || '';
      const mobileApiPort = parseInt(txt.mobileApiPort || String(service.port), 10) || 19480;

      const addresses: string[] = service.addresses ?? [];
      const address = addresses.find((a: string) => /^\d+\.\d+\.\d+\.\d+$/.test(a)) ?? addresses[0] ?? '';
      if (!address) return;

      const desktop: DiscoveredDesktop = {
        instanceId,
        deviceName,
        address,
        mobileApiPort,
        fingerprint,
        lastSeen: new Date(),
      };

      console.log(`[Discovery] Found: "${deviceName}" at ${address}:${mobileApiPort}`);
      discovered.set(instanceId, desktop);
      notifyListeners();
      updatePairedDesktops(desktop);
    });

    zeroconfInstance.on('removed', (name: string) => {
      for (const [id, d] of discovered) {
        if (name.includes(id) || name.includes(d.deviceName)) {
          console.log(`[Discovery] Lost: "${d.deviceName}"`);
          discovered.delete(id);
          notifyListeners();
          break;
        }
      }
    });

    zeroconfInstance.on('error', (err: any) => {
      console.warn('[Discovery] Error:', err);
    });

    zeroconfInstance.scan('codetrellis', 'tcp', 'local.');
    browsing = true;
    console.log('[Discovery] Browsing for _codetrellis._tcp');
  } catch (err) {
    // In Expo Go or when native module is missing, any of the above
    // can throw. Silently degrade — discovery is not essential.
    console.warn('[Discovery] Not available (native module missing):', err);
    zeroconfInstance = null;
  }
}

/**
 * Stop browsing.
 */
export function stopDiscovery(): void {
  if (zeroconfInstance && browsing) {
    try { zeroconfInstance.stop(); } catch { /* */ }
    browsing = false;
    console.log('[Discovery] Stopped');
  }
}

/**
 * Get all currently discovered desktops.
 */
export function getDiscoveredDesktops(): DiscoveredDesktop[] {
  return Array.from(discovered.values());
}

/**
 * Register a listener for discovery changes.
 */
export function onDiscoveryChange(cb: (desktops: DiscoveredDesktop[]) => void): () => void {
  listeners.add(cb);
  return () => { listeners.delete(cb); };
}

/**
 * Whether discovery is currently active.
 */
export function isDiscoveryActive(): boolean {
  return browsing;
}

// --- Internals ---------------------------------------------------------------

function notifyListeners(): void {
  const list = Array.from(discovered.values());
  for (const cb of listeners) {
    try { cb(list); } catch { /* */ }
  }
}

/**
 * When a desktop is discovered via mDNS, update any matching paired
 * desktops in storage with the fresh address and port. This handles
 * DHCP address changes and port auto-increments transparently.
 */
async function updatePairedDesktops(desktop: DiscoveredDesktop): Promise<void> {
  try {
    const devices = await loadPairedDesktops();
    for (const device of devices) {
      // Match by fingerprint or alias (best effort)
      const fingerprintMatch = desktop.fingerprint && desktop.fingerprint !== 'pending' &&
        device.fingerprint === desktop.fingerprint;
      const aliasMatch = device.alias && desktop.deviceName &&
        desktop.deviceName.toLowerCase().includes(device.alias.toLowerCase());

      if (fingerprintMatch || aliasMatch) {
        const needsUpdate =
          device.lastKnownAddress !== desktop.address ||
          (device.lastKnownPort || 0) !== desktop.mobileApiPort;

        if (needsUpdate) {
          console.log(`[Discovery] Updating "${device.alias}" → ${desktop.address}:${desktop.mobileApiPort}`);
          await upsertPairedDesktop({
            ...device,
            lastKnownAddress: desktop.address,
            lastKnownPort: desktop.mobileApiPort,
          });
        }
      }
    }
  } catch (err) {
    console.warn('[Discovery] Failed to update paired desktops:', err);
  }
}
