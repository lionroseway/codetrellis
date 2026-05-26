/**
 * mDNS discovery service — Phase 9.1 of the CDev target architecture.
 *
 * Advertises this CodeTrellis instance on the local network via
 * Bonjour/mDNS so other devices (desktops, mobile companions) can
 * discover it. Also browses for other instances continuously.
 *
 * mDNS is **informational only** — it says "I'm here" but does not
 * establish a connection. Connections happen via QR-based WebRTC
 * pairing (Phase 9.2).
 *
 * Uses `bonjour-service` (pure JS, no native deps, cross-platform).
 */

import os from 'node:os';
import { randomUUID } from 'node:crypto';
import type { DiscoveredPeer } from '../../shared/types';
import { BUILD_INFO } from '../../shared/build-info';

// Lazy-load bonjour-service to keep startup fast and avoid crashes if
// the module fails (e.g. UDP port 5353 already in use).
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let Bonjour: any = null;

// --- Constants ---------------------------------------------------------------

const SERVICE_TYPE = 'codetrellis';
const STALE_PEER_MS = 120_000; // 2 minutes without seeing → remove

// --- State -------------------------------------------------------------------

/**
 * Persistent instance ID — generated once per backend process. Used to
 * distinguish this instance from others in mDNS records. Not persisted
 * across restarts — it's ephemeral, like a session ID for discovery.
 */
const instanceId = randomUUID().slice(0, 8);

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let bonjourInstance: any = null;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let publishedService: any = null;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let browser: any = null;
let sweepInterval: ReturnType<typeof setInterval> | null = null;

/** Discovered peers, keyed by instanceId. */
const peers = new Map<string, DiscoveredPeer>();

/** Callbacks registered via `onPeerDiscovered` / `onPeerLost`. */
const listeners = {
  discovered: new Set<(peer: DiscoveredPeer) => void>(),
  lost: new Set<(peer: DiscoveredPeer) => void>(),
};

// --- Public API --------------------------------------------------------------

/**
 * Get the instance ID for this running CodeTrellis.
 */
export function getInstanceId(): string {
  return instanceId;
}

/**
 * Start advertising this CodeTrellis instance and browsing for others.
 * Safe to call multiple times — restarts cleanly.
 *
 * @param deviceName  Human-readable name (from settings or os.hostname()).
 * @param fingerprint DTLS fingerprint for identity (from WebRTC cert).
 */
export function startMdns(deviceName?: string, fingerprint?: string): void {
  // Stop any previous instance
  stopMdns();

  try {
    if (!Bonjour) {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const mod = require('bonjour-service');
      Bonjour = mod.default ?? mod.Bonjour ?? mod;
    }
    bonjourInstance = new Bonjour!();
  } catch (err) {
    console.warn('[mDNS] Failed to initialise bonjour-service — discovery disabled:', err);
    return;
  }

  const name = deviceName || os.hostname();
  const version = BUILD_INFO?.version ?? '0.0.0';
  const fp = fingerprint || 'pending'; // Real fingerprint set once WebRTC cert is generated

  // Publish our service.
  // Port is 1 (placeholder) because we don't accept TCP connections —
  // mDNS is informational only. Peers connect via WebRTC, not TCP.
  // bonjour-service requires port > 0; the value is meaningless here.
  try {
    publishedService = bonjourInstance.publish({
      name: `${name} (${instanceId})`,
      type: SERVICE_TYPE,
      port: 1,
      txt: {
        instanceId,
        version,
        fingerprint: fp,
        deviceName: name,
      },
    });
    console.log(`[mDNS] Advertising as "${name}" (${instanceId})`);
  } catch (err) {
    console.warn('[mDNS] Failed to publish service:', err);
  }

  // Browse for other instances.
  try {
    browser = bonjourInstance.find({ type: SERVICE_TYPE });

    browser.on('up', (service: { txt?: Record<string, string>; host?: string; addresses?: string[] }) => {
      const txt = service.txt ?? {};
      const peerInstanceId = txt.instanceId;
      if (!peerInstanceId || peerInstanceId === instanceId) return; // Ignore self

      const address = service.addresses?.[0] ?? service.host ?? '';
      const peer: DiscoveredPeer = {
        instanceId: peerInstanceId,
        name: txt.deviceName || 'Unknown',
        version: txt.version || '?',
        fingerprint: txt.fingerprint || '',
        address,
        lastSeen: new Date().toISOString(),
      };

      const isNew = !peers.has(peerInstanceId);
      peers.set(peerInstanceId, peer);

      if (isNew) {
        console.log(`[mDNS] Discovered peer: "${peer.name}" at ${peer.address}`);
        for (const cb of listeners.discovered) {
          try { cb(peer); } catch { /* listener error */ }
        }
      }
    });

    browser.on('down', (service: { txt?: Record<string, string> }) => {
      const txt = service.txt ?? {};
      const peerInstanceId = txt.instanceId;
      if (!peerInstanceId) return;

      const peer = peers.get(peerInstanceId);
      if (peer) {
        peers.delete(peerInstanceId);
        console.log(`[mDNS] Lost peer: "${peer.name}"`);
        for (const cb of listeners.lost) {
          try { cb(peer); } catch { /* listener error */ }
        }
      }
    });

    console.log(`[mDNS] Browsing for _${SERVICE_TYPE}._tcp services`);
  } catch (err) {
    console.warn('[mDNS] Failed to start browser:', err);
  }

  // Periodic stale peer sweep — removes peers not seen for 2 minutes.
  sweepInterval = setInterval(() => {
    const cutoff = Date.now() - STALE_PEER_MS;
    for (const [id, peer] of peers) {
      if (new Date(peer.lastSeen).getTime() < cutoff) {
        peers.delete(id);
        console.log(`[mDNS] Stale peer removed: "${peer.name}"`);
        for (const cb of listeners.lost) {
          try { cb(peer); } catch { /* listener error */ }
        }
      }
    }
  }, 30_000);
}

/**
 * Stop advertising and browsing. Cleans up all resources.
 */
export function stopMdns(): void {
  if (sweepInterval) {
    clearInterval(sweepInterval);
    sweepInterval = null;
  }

  if (publishedService) {
    try { publishedService.stop?.(); } catch { /* ignore */ }
    publishedService = null;
  }

  if (browser) {
    try { browser.stop(); } catch { /* ignore */ }
    browser = null;
  }

  if (bonjourInstance) {
    try { bonjourInstance.destroy(); } catch { /* ignore */ }
    bonjourInstance = null;
  }

  peers.clear();
}

/**
 * Update the advertised device name (e.g. after settings change).
 */
export function updateAdvertisedName(name: string, fingerprint?: string): void {
  if (!bonjourInstance) return;
  // Simplest approach: restart with the new name.
  startMdns(name, fingerprint);
}

/**
 * Get all currently discovered peers.
 */
export function getDiscoveredPeers(): DiscoveredPeer[] {
  return Array.from(peers.values());
}

/**
 * Get a discovered peer by instanceId.
 */
export function getDiscoveredPeer(peerInstanceId: string): DiscoveredPeer | undefined {
  return peers.get(peerInstanceId);
}

/**
 * Register a callback for when a peer is discovered.
 */
export function onPeerDiscovered(cb: (peer: DiscoveredPeer) => void): () => void {
  listeners.discovered.add(cb);
  return () => { listeners.discovered.delete(cb); };
}

/**
 * Register a callback for when a peer is lost.
 */
export function onPeerLost(cb: (peer: DiscoveredPeer) => void): () => void {
  listeners.lost.add(cb);
  return () => { listeners.lost.delete(cb); };
}

/**
 * Whether the mDNS service is currently running.
 */
export function isMdnsRunning(): boolean {
  return bonjourInstance !== null;
}
