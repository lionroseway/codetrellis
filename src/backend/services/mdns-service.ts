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
import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import type { DiscoveredPeer } from '../../shared/types';
import { BUILD_INFO } from '../../shared/build-info';
import { getSettingsDir } from './persistence';

// Lazy-load bonjour-service to keep startup fast and avoid crashes if
// the module fails (e.g. UDP port 5353 already in use).
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let Bonjour: any = null;

// --- Constants ---------------------------------------------------------------

const SERVICE_TYPE = 'codetrellis';
const STALE_PEER_MS = 120_000; // 2 minutes without seeing → remove

// --- State -------------------------------------------------------------------

/** Stable per-machine base id (one per settings dir). */
const BASE_ID_FILE = 'mdns-instance-id';
/** Live-instance registry: which pid currently owns which advertised id. */
const INSTANCES_FILE = 'mdns-instances.json';

interface LiveInstance {
  /** The mDNS id this process advertises (host = codetrellis-<id>.local). */
  id: string;
  /** OS pid that owns it — used to detect crashed/dead owners on next launch. */
  pid: number;
  startedAt: string;
}

/**
 * Is a pid currently running? `kill(pid, 0)` sends no signal — it only probes.
 * ESRCH → no such process (dead); EPERM → exists but owned by another user.
 */
function isPidAlive(pid: number): boolean {
  if (!pid || pid === process.pid) return false; // our own (re-used) pid → treat as stale
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    return (err as NodeJS.ErrnoException).code === 'EPERM';
  }
}

function readLiveInstances(dir: string): LiveInstance[] {
  try {
    const arr = JSON.parse(fs.readFileSync(path.join(dir, INSTANCES_FILE), 'utf-8'));
    return Array.isArray(arr)
      ? arr.filter((e) => e && typeof e.id === 'string' && typeof e.pid === 'number')
      : [];
  } catch {
    return [];
  }
}

function writeLiveInstances(dir: string, list: LiveInstance[]): void {
  try {
    fs.mkdirSync(dir, { recursive: true });
    const tmp = path.join(dir, `${INSTANCES_FILE}.tmp`);
    fs.writeFileSync(tmp, JSON.stringify(list), 'utf-8');
    fs.renameSync(tmp, path.join(dir, INSTANCES_FILE)); // atomic-ish swap
  } catch {
    /* best-effort — registry is an optimisation, not load-bearing */
  }
}

function loadStableBaseId(dir: string): string {
  try {
    const file = path.join(dir, BASE_ID_FILE);
    if (fs.existsSync(file)) {
      const existing = fs.readFileSync(file, 'utf-8').trim();
      if (/^[0-9a-f]{8}$/i.test(existing)) return existing;
    }
    const id = randomUUID().slice(0, 8);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(file, id, 'utf-8');
    return id;
  } catch {
    return randomUUID().slice(0, 8);
  }
}

/**
 * Acquire this process's advertised mDNS id.
 *
 * Prefers the STABLE base id so a crash + restart re-announces the same record
 * (the responder refreshes it rather than stacking a ghost — see commit history).
 * But before reusing it we check the live-instance registry: if another CURRENTLY
 * RUNNING process already owns that id (the dev server + packaged app on one
 * machine, say), we take a distinct id instead. Two responders publishing the
 * same `codetrellis-<id>.local` A-record on one host is exactly what drives
 * macOS to rename its own `.local` hostname to "…-2" — so we never let it happen.
 *
 * Dead owners (crashed without cleanup) are pruned here on startup — this is the
 * "did we leave something registered, is it still there?" check.
 */
function acquireInstanceId(): string {
  let dir: string;
  try {
    dir = getSettingsDir();
  } catch {
    return randomUUID().slice(0, 8); // no settings dir → ephemeral, still unique
  }

  const baseId = loadStableBaseId(dir);
  // Keep only entries whose owning process is still alive (prunes crash ghosts).
  const live = readLiveInstances(dir).filter((e) => isPidAlive(e.pid));
  const taken = new Set(live.map((e) => e.id));

  let chosen = baseId;
  if (taken.has(chosen)) {
    // A live sibling holds the base id — derive a distinct, collision-free one.
    for (let i = 0; i < 50 && taken.has(chosen); i++) {
      chosen = `${baseId}${randomUUID().slice(0, 2)}`.slice(0, 12);
    }
    if (taken.has(chosen)) chosen = randomUUID().slice(0, 8); // last resort
    console.log(`[mDNS] Base id ${baseId} held by a live instance — using ${chosen} to avoid an A-record collision.`);
  }

  writeLiveInstances(dir, [...live, { id: chosen, pid: process.pid, startedAt: new Date().toISOString() }]);
  return chosen;
}

/** Drop this process's entry from the live-instance registry (clean shutdown). */
function releaseInstanceId(): void {
  try {
    const dir = getSettingsDir();
    writeLiveInstances(dir, readLiveInstances(dir).filter((e) => e.pid !== process.pid && isPidAlive(e.pid)));
  } catch {
    /* best-effort */
  }
}

const instanceId = acquireInstanceId();

// Best-effort cleanup on normal exit. Hard crashes are caught by the
// liveness prune on the next launch (above), so a missed release never stacks.
process.once('exit', () => releaseInstanceId());

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
 * @param deviceName     Human-readable name (from settings or os.hostname()).
 * @param fingerprint    DTLS fingerprint for identity (from WebRTC cert).
 * @param mobileApiPort  Port the mobile API server is listening on (advertised via TXT).
 */
export function startMdns(deviceName?: string, fingerprint?: string, mobileApiPort?: number): void {
  // Stop any previous instance
  stopMdns();

  try {
    if (!Bonjour) {
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
  // The port is the mobile API server port (for reconnection).
  // If no mobile API port is provided, use 1 as a placeholder.
  // bonjour-service requires port > 0.
  const advertisePort = mobileApiPort && mobileApiPort > 0 ? mobileApiPort : 1;
  try {
    publishedService = bonjourInstance.publish({
      name: `${name} (${instanceId})`,
      type: SERVICE_TYPE,
      // Advertise under a unique, CodeTrellis-owned hostname rather than the
      // machine's real `.local` name. bonjour-service runs its own mDNS
      // responder and announces A-records for `host`; if that's the system
      // hostname (the default), it collides with macOS's built-in Bonjour
      // responder, which resolves the conflict by renaming the Mac to
      // "…-2.local", "…-3.local" on every (especially unclean) restart.
      // A dedicated host keeps discovery working (peers read the IP from the
      // record's addresses) without ever touching the OS hostname.
      host: `codetrellis-${instanceId}.local`,
      port: advertisePort,
      txt: {
        instanceId,
        version,
        fingerprint: fp,
        deviceName: name,
        mobileApiPort: String(advertisePort),
      },
    });
    console.log(`[mDNS] Advertising as "${name}" (${instanceId}) mobileApiPort=${advertisePort}`);
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
export function updateAdvertisedName(name: string, fingerprint?: string, mobileApiPort?: number): void {
  if (!bonjourInstance) return;
  // Simplest approach: restart with the new name.
  startMdns(name, fingerprint, mobileApiPort);
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
