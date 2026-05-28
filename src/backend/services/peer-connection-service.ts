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
  isPairingActive,
  getStoredOfferSdp,
  getConfirmationCode,
} from './pairing-service';
import {
  createOffer,
  connectWithAnswer,
  discardPendingOffer,
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
// Phase 10 — multi-device services
import { startStateSync, stopStateSync, isStateSyncRunning } from './state-sync-service';
import { startRemoteTerminals, stopRemoteTerminals, isRemoteTerminalRunning } from './remote-terminal-service';
import { startRemoteAudio, stopRemoteAudio, isRemoteAudioRunning } from './remote-audio-service';
import { startRemoteInteraction, stopRemoteInteraction, isRemoteInteractionRunning } from './remote-interaction-service';
import { startPushNotifications, stopPushNotifications, isPushNotificationsRunning } from './push-notification-service';

// --- State -------------------------------------------------------------------

let started = false;
// (v4: answer is managed by pairing-service, no local state needed)

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

  // Phase 10 — start multi-device services
  const myInstanceId = getInstanceId();
  startStateSync(myInstanceId);
  startRemoteTerminals();
  startRemoteAudio();
  startRemoteInteraction(myInstanceId);
  startPushNotifications();

  console.log('[PeerManager] Started (with Phase 10 + Phase 11 services)');
}

/**
 * Stop the peer connection manager. Disconnects all peers and
 * stops mDNS. Called during graceful shutdown.
 */
export async function stopPeerManager(): Promise<void> {
  if (!started) return;
  started = false;

  // Phase 10/11 — stop multi-device + push services
  stopPushNotifications();
  stopRemoteInteraction();
  stopRemoteAudio();
  stopRemoteTerminals();
  stopStateSync();

  cancelPairing();
  await discardPendingOffer();
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
 * Start a v4 pairing session. Opens a temp HTTP server, creates a
 * WebRTC offer, and returns the QR payload `{v:4, h, p, c}`.
 *
 * The phone scans the QR, fetches the full SDP from the temp server,
 * creates its answer, and posts it back. After the answer arrives,
 * call `completePairing()` to establish WebRTC and confirm.
 */
export async function startPairing(): Promise<{
  qrPayload: PairingQrPayload;
  waitForAnswer: () => Promise<void>;
}> {
  // Create WebRTC offer (keeps PC alive for DTLS cert reuse)
  const { offer, iceCandidates, fingerprint } = await createOffer();

  // Open temp server + get QR payload
  const { qrPayload, waitForAnswer: waitRaw } = await initiatePairing(
    offer,
    iceCandidates,
    fingerprint,
  );

  // Wrap: when the answer arrives, connect WebRTC automatically
  const waitForAnswer = async (): Promise<void> => {
    const answer = await waitRaw();

    // Establish WebRTC connection using the full SDPs
    const offerSdp = getStoredOfferSdp();
    if (!offerSdp) throw new Error('Offer SDP lost');

    await connectWithAnswer(
      offerSdp,
      answer.answerSdp,
      answer.iceCandidates,
      answer.fingerprint,
      'Pending…', // alias set on confirm
      'mobile',
    );
  };

  return { qrPayload, waitForAnswer };
}

/**
 * Get the Bluetooth-style confirmation code for the current pairing.
 * Available after the phone's answer has been received and WebRTC
 * is connecting.
 */
export function getPairingConfirmCode(): string | null {
  return getConfirmationCode();
}

/**
 * Complete pairing after the user verifies the confirmation code.
 * Stores the paired device record.
 *
 * @param userEnteredCode  The 6-digit code the user saw on their phone.
 * @param deviceAlias      Human-readable name for the device.
 * @param deviceType       Desktop, mobile, or unknown.
 */
export function completePairing(
  userEnteredCode: string,
  deviceAlias: string,
  deviceType: 'desktop' | 'mobile' | 'unknown' = 'mobile',
): { success: boolean; device?: PairedDevice; error?: string } {
  const device = confirmPairing(userEnteredCode, deviceAlias, deviceType);

  if (!device) {
    return { success: false, error: 'Confirmation code mismatch or no active session' };
  }

  return { success: true, device };
}

/**
 * Cancel the active pairing session. Also discards the pending
 * offer PC (whose DTLS certificate would never be used).
 */
export function cancelActivePairing(): void {
  cancelPairing();
  discardPendingOffer().catch(() => {});
}

/**
 * Whether a pairing session is currently in progress.
 */
export { isPairingActive } from './pairing-service';

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

// --- Phase 10: Re-exports for multi-device services -------------------------

// State sync
export {
  getRemoteState,
  getAllRemoteStates,
  onRemoteStateChange,
  collectSnapshot,
  isStateSyncRunning,
} from './state-sync-service';

// Remote terminals
export {
  getRemoteTerminals,
  getRemoteTerminalsForPeer,
  writeRemoteTerminal,
  resizeRemoteTerminal,
  onRemoteTerminalEvent,
  isRemoteTerminalRunning,
} from './remote-terminal-service';

// Remote audio
export {
  forwardAudioChunk,
  broadcastAudioStatus,
  broadcastAudioStopped,
  getRemoteAudioStatuses,
  getRemoteAudioStatus,
  onRemoteAudioEvent,
  isRemoteAudioRunning,
} from './remote-audio-service';

// Remote agent interaction
export {
  broadcastChannelEvent,
  broadcastChannelResolved,
  broadcastInputRequest,
  respondToInputRequest,
  broadcastAgentSessions,
  getPendingInputRequests,
  getPendingInputRequest,
  onRemoteChannelEvent,
  onRemoteInteractionEvent,
  isRemoteInteractionRunning,
} from './remote-interaction-service';

// Push notifications (Phase 11)
export {
  registerPushToken,
  unregisterPushToken,
  listPushTokens,
  pushForChannelEvent,
  pushForInputRequest,
  isPushNotificationsRunning,
} from './push-notification-service';

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
  stateSync: boolean;
  remoteTerminals: boolean;
  remoteAudio: boolean;
  remoteInteraction: boolean;
  pushNotifications: boolean;
} {
  return {
    running: started,
    instanceId: getInstanceId(),
    discoveryActive: isDiscoveryActive(),
    discoveredPeers: getDiscoveredPeers().length,
    pairedDevices: listPairedDevices().length,
    connectedPeers: connectedPeerCount(),
    pairingActive: isPairingActive(),
    stateSync: isStateSyncRunning(),
    remoteTerminals: isRemoteTerminalRunning(),
    remoteAudio: isRemoteAudioRunning(),
    remoteInteraction: isRemoteInteractionRunning(),
    pushNotifications: isPushNotificationsRunning(),
  };
}
