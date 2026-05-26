/**
 * Peer connection manager — Phase 9.3 of the CDev target architecture.
 *
 * Orchestrates the full lifecycle: mDNS discovery → pairing →
 * WebRTC connection → heartbeat → reconnection. Ties together:
 *
 *   - `mdns-service.ts` — discovery of nearby instances
 *   - `pairing-service.ts` — QR-based WebRTC signalling
 *   - `webrtc-service.ts` — WebRTC peer connections
 *   - `paired-device-service.ts` — persistent device storage
 *
 * Exposes a high-level API for the MCP tools and REST routes.
 */

import type {
  DiscoveredPeer,
  PairedDevice,
  PeerConnectionInfo,
  PairingQrPayload,
  PairingAnswer,
} from '../../shared/types';
import {
  startMdns,
  stopMdns,
  getDiscoveredPeers,
  getInstanceId,
  onPeerDiscovered,
  isMdnsRunning,
} from './mdns-service';
import {
  listPairedDevices,
  getPairedDevice,
  removePairedDevice,
  touchPairedDevice,
  renamePairedDevice,
  linkInstanceId,
} from './paired-device-service';
import {
  initiatePairing,
  cancelPairing,
  confirmPairing,
  deriveConfirmationCode,
  isPairingActive,
  submitAnswerManually,
} from './pairing-service';
import {
  createOffer,
  connectWithAnswer,
  disconnectPeer,
  disconnectAllPeers,
  getPeerConnections,
  getPeerConnection,
  sendToPeer,
  broadcastToAllPeers,
  onChannelMessage,
  onConnectionStateChange,
  connectedPeerCount,
} from './webrtc-service';
import { getSettings } from './settings-service';

// --- State -------------------------------------------------------------------

let started = false;
let pendingAnswer: PairingAnswer | null = null;

// --- Public API: Lifecycle ---------------------------------------------------

/**
 * Start the peer connection manager. Initialises mDNS discovery
 * and sets up auto-reconnect for known paired devices.
 *
 * Called from `initializeBackend()` during server startup.
 */
export function startPeerManager(): void {
  if (started) return;
  started = true;

  const settings = getSettings();
  const deviceName = settings.device.deviceName || undefined;

  // Start mDNS if advertising is enabled
  if (settings.device.advertise) {
    startMdns(deviceName);
  }

  // When a peer is discovered, check if it matches a paired device
  // and attempt auto-reconnect.
  onPeerDiscovered((peer: DiscoveredPeer) => {
    const paired = listPairedDevices().find(
      (d) => d.fingerprint === peer.fingerprint,
    );
    if (paired) {
      console.log(`[PeerManager] Discovered known device "${peer.name}" — will attempt auto-reconnect`);
      linkInstanceId(paired.fingerprint, peer.instanceId);
      // TODO: implement auto-reconnect using stored shared secret
    }
  });

  // Log connection state changes
  onConnectionStateChange((fingerprint, state) => {
    if (state === 'connected') {
      touchPairedDevice(fingerprint);
    }
    console.log(`[PeerManager] Peer ${fingerprint.slice(0, 12)}… → ${state}`);
  });

  console.log('[PeerManager] Started');
}

/**
 * Stop the peer connection manager. Disconnects all peers and
 * stops mDNS. Called during graceful shutdown.
 */
export async function stopPeerManager(): Promise<void> {
  if (!started) return;
  started = false;

  cancelPairing();
  await disconnectAllPeers();
  stopMdns();

  console.log('[PeerManager] Stopped');
}

// --- Public API: Discovery ---------------------------------------------------

/**
 * Get all discovered peers on the local network.
 */
export function getDiscoveredDevices(): DiscoveredPeer[] {
  return getDiscoveredPeers();
}

/**
 * Get this instance's mDNS instance ID.
 */
export function getThisInstanceId(): string {
  return getInstanceId();
}

/**
 * Whether mDNS discovery is currently active.
 */
export function isDiscoveryActive(): boolean {
  return isMdnsRunning();
}

// --- Public API: Pairing -----------------------------------------------------

/**
 * Start a pairing session. Returns the QR payload and a promise
 * that resolves when the peer sends its answer.
 */
export async function startPairing(): Promise<{
  qrPayload: PairingQrPayload;
  waitForAnswer: () => Promise<PairingAnswer>;
}> {
  // Create WebRTC offer
  const { offer, iceCandidates, fingerprint } = await createOffer();

  // Initiate pairing (generates QR + opens ephemeral UDP)
  return initiatePairing(offer, iceCandidates, fingerprint);
}

/**
 * Complete pairing after the answer arrives and the user enters the code.
 */
export async function completePairing(
  answer: PairingAnswer,
  userEnteredCode: string,
  deviceAlias: string,
  deviceType: 'desktop' | 'mobile' | 'unknown' = 'unknown',
): Promise<{ success: boolean; device?: PairedDevice; error?: string }> {
  // Verify the confirmation code
  const expectedCode = deriveConfirmationCode(answer.fp, answer.nonce);
  if (userEnteredCode !== expectedCode && userEnteredCode !== answer.code) {
    return { success: false, error: 'Confirmation code mismatch' };
  }

  try {
    // Complete the WebRTC connection
    const entry = await connectWithAnswer(
      '', // offer SDP (from the original offer — TODO: pass through)
      answer.answer,
      answer.ice,
      answer.fp,
      deviceAlias,
      deviceType,
    );

    // Store the paired device
    const sharedSecret = ''; // TODO: extract from DTLS handshake
    const device = confirmPairing(
      answer,
      userEnteredCode,
      deviceAlias,
      deviceType,
      sharedSecret,
    );

    if (!device) {
      return { success: false, error: 'Failed to confirm pairing' };
    }

    return { success: true, device };
  } catch (err) {
    return { success: false, error: `WebRTC connection failed: ${err}` };
  }
}

/**
 * Cancel the active pairing session.
 */
export { cancelPairing } from './pairing-service';

/**
 * Whether a pairing session is currently in progress.
 */
export { isPairingActive } from './pairing-service';

/**
 * Submit an answer manually (fallback for when UDP doesn't work).
 */
export { submitAnswerManually } from './pairing-service';

// --- Public API: Paired Devices ----------------------------------------------

/**
 * Get all paired devices.
 */
export function getDevices(): PairedDevice[] {
  return listPairedDevices();
}

/**
 * Get a specific paired device.
 */
export function getDevice(fingerprint: string): PairedDevice | undefined {
  return getPairedDevice(fingerprint);
}

/**
 * Unpair and disconnect a device.
 */
export async function unpairDevice(fingerprint: string): Promise<boolean> {
  await disconnectPeer(fingerprint);
  return removePairedDevice(fingerprint);
}

/**
 * Rename a paired device.
 */
export function renameDevice(fingerprint: string, alias: string): boolean {
  return renamePairedDevice(fingerprint, alias);
}

// --- Public API: Connections -------------------------------------------------

/**
 * Get all active peer connections.
 */
export function getConnections(): PeerConnectionInfo[] {
  return getPeerConnections();
}

/**
 * Get a specific peer connection.
 */
export function getConnection(fingerprint: string): PeerConnectionInfo | undefined {
  return getPeerConnection(fingerprint);
}

/**
 * Disconnect a specific peer (without unpairing).
 */
export async function disconnect(fingerprint: string): Promise<void> {
  await disconnectPeer(fingerprint);
}

/**
 * Number of currently connected peers.
 */
export function getConnectedCount(): number {
  return connectedPeerCount();
}

// --- Public API: Messaging ---------------------------------------------------

export { sendToPeer, broadcastToAllPeers, onChannelMessage, onConnectionStateChange };

// --- Summary -----------------------------------------------------------------

/**
 * Full status of the peer connection manager.
 */
export function getPeerManagerStatus(): {
  running: boolean;
  instanceId: string;
  discoveryActive: boolean;
  discoveredPeers: number;
  pairedDevices: number;
  connectedPeers: number;
  pairingActive: boolean;
} {
  return {
    running: started,
    instanceId: getInstanceId(),
    discoveryActive: isDiscoveryActive(),
    discoveredPeers: getDiscoveredPeers().length,
    pairedDevices: listPairedDevices().length,
    connectedPeers: connectedPeerCount(),
    pairingActive: isPairingActive(),
  };
}
