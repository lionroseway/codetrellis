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
import { extractSingleFingerprint, fingerprintsEqual } from '../../shared/lib/sdp-fingerprint';
// Phase 10 — multi-device services
import { startStateSync, stopStateSync, isStateSyncRunning } from './state-sync-service';
import { startRemoteTerminals, stopRemoteTerminals, isRemoteTerminalRunning } from './remote-terminal-service';
import { startRemoteAudio, stopRemoteAudio, isRemoteAudioRunning } from './remote-audio-service';
import { startRemoteInteraction, stopRemoteInteraction, isRemoteInteractionRunning } from './remote-interaction-service';
import { startPushNotifications, stopPushNotifications, isPushNotificationsRunning } from './push-notification-service';
import { startMobileRpc, stopMobileRpc } from './mobile-rpc-service';
import { startMobileApiServer, stopMobileApiServer, getMobileApiPort, isMobileApiRunning } from './mobile-api-server';

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
export async function startPeerManager(): Promise<void> {
  if (started) return;
  started = true;

  const settings = getSettings();
  const deviceName = settings.device.deviceName || undefined;

  // Start the mobile API server ONLY when the user has asked for it.
  //
  // This used to run unconditionally, so :19480 bound 0.0.0.0 — every
  // interface — on every launch, whatever the settings said. Only mDNS was
  // gated, which meant the machine was reachable on any network it joined
  // and merely not announcing itself. That is the LAN entry point behind the
  // whole peer finding set (Phase 19, A3 / 1.4).
  //
  // Discovery and exposure are separate switches now: advertising without a
  // listener is inert, and a listener without advertising is still reachable
  // by anyone who knows the address. The listener is the one that matters.
  let mobilePort = 0;
  if (settings.device.exposeMobileApi) {
    try {
      mobilePort = await startMobileApiServer();
      console.log('[PeerManager] Mobile API exposed on the local network (user-enabled)');
    } catch (err) {
      console.warn('[PeerManager] Mobile API server failed to start:', err);
    }
  } else {
    console.log('[PeerManager] Mobile API NOT exposed — enable it in Settings → Devices to pair a phone');
  }

  // Advertise over mDNS only if separately enabled. Advertising a port we
  // never bound would be worse than useless, so pass whatever we actually got.
  if (settings.device.advertise) {
    startMdns(deviceName, undefined, mobilePort);
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
  startMobileRpc();

  console.log(`[PeerManager] Started (mobileApiPort=${mobilePort || 'none'})`);
}

/**
 * Stop the peer connection manager. Disconnects all peers and
 * stops mDNS. Called during graceful shutdown.
 */
export async function stopPeerManager(): Promise<void> {
  if (!started) return;
  started = false;

  // Phase 10/11 — stop multi-device + push services
  stopMobileRpc();
  stopPushNotifications();
  stopRemoteInteraction();
  stopRemoteAudio();
  stopRemoteTerminals();
  stopStateSync();

  // Stop mobile API server + mDNS
  stopMobileApiServer();
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

// --- Public API: Mobile Reconnection -----------------------------------------

/**
 * State for an active reconnection offer.
 * One per fingerprint — if a second request comes in, the first is discarded.
 */
const reconnectOffers = new Map<string, {
  offerSdp: string;
  iceCandidates: string[];
  desktopFingerprint: string;
  createdAt: number;
}>();

// Clean up stale reconnect offers older than 60s, checked lazily
function purgeStaleOffers(): void {
  const now = Date.now();
  for (const [fp, entry] of reconnectOffers) {
    if (now - entry.createdAt > 60_000) {
      reconnectOffers.delete(fp);
    }
  }
}

/**
 * Find a paired device by its stable pairingId (not the ephemeral fingerprint).
 */
function findByPairingId(pairingId: string): PairedDevice | undefined {
  return listPairedDevices().find((d) => d.pairingId === pairingId);
}

/**
 * Find a paired device by its ephemeral DTLS fingerprint.
 * Used as a fallback for pre-pairingId mobile clients during upgrade.
 */
function findByFingerprint(fingerprint: string): PairedDevice | undefined {
  return listPairedDevices().find((d) => d.fingerprint === fingerprint);
}

/**
 * Create a reconnection offer for a previously paired mobile device.
 *
 * Auth priority:
 *   1. `pairingId` — stable UUID agreed during pairing (preferred).
 *   2. `fingerprint` — ephemeral DTLS fingerprint (fallback for
 *      pre-pairingId mobile clients; enables silent upgrade).
 *
 * Returns the SDP offer, ICE candidates, desktop fingerprint, and
 * the device's pairingId (so the mobile can store it on upgrade).
 */
export async function startReconnection(pairingId?: string, fingerprint?: string): Promise<{
  offer: string;
  iceCandidates: string[];
  fingerprint: string;
  pairingId: string;
} | null> {
  purgeStaleOffers();

  // Look up by stable pairingId first, then fall back to fingerprint
  let paired: PairedDevice | undefined;
  if (pairingId) {
    paired = findByPairingId(pairingId);
  }
  if (!paired && fingerprint) {
    paired = findByFingerprint(fingerprint);
    if (paired) {
      console.log(`[PeerManager] Fingerprint fallback matched "${paired.alias}" — silent pairingId upgrade`);
    }
  }

  if (!paired) {
    console.warn(`[PeerManager] Reconnect rejected — no match for pairingId=${pairingId?.slice(0, 8) ?? 'none'} fp=${fingerprint?.slice(0, 12) ?? 'none'}`);
    return null;
  }

  const devicePairingId = paired.pairingId;
  console.log(`[PeerManager] Creating reconnect offer for "${paired.alias}" (pairingId=${devicePairingId.slice(0, 8)}…)`);

  // Create a fresh WebRTC offer
  const { offer, iceCandidates, fingerprint: desktopFp } = await createOffer();

  // Store keyed by pairingId so completeReconnection() can find it
  reconnectOffers.set(devicePairingId, {
    offerSdp: offer,
    iceCandidates,
    desktopFingerprint: desktopFp,
    createdAt: Date.now(),
  });

  return { offer, iceCandidates, fingerprint: desktopFp, pairingId: devicePairingId };
}

/**
 * Complete the reconnection after the mobile posts its answer SDP.
 * Sets up data channels and heartbeat — same as initial pairing.
 */
export async function completeReconnection(
  pairingId: string,
  answerSdp: string,
  answerIceCandidates: string[],
  mobileFingerprint: string,
): Promise<boolean> {
  const stored = reconnectOffers.get(pairingId);
  if (!stored) {
    console.warn(`[PeerManager] No pending reconnect offer for pairingId=${pairingId.slice(0, 8)}…`);
    return false;
  }

  reconnectOffers.delete(pairingId);

  const paired = findByPairingId(pairingId);
  if (!paired) return false;

  // ── IDENTITY CHECK (Phase 19, finding 2) ──────────────────────────────
  //
  // There was NO comparison here at all. `mobileFingerprint` arrived in the
  // request body and was passed straight through as the peer's identity, so
  // any caller who knew a pairingId could claim to be that device. The
  // reviewer connected with a different certificate, asserted the stored
  // fingerprint, and watched all four channels open.
  //
  // The body value is now IGNORED entirely — a self-asserted identity is
  // not evidence. The fingerprint is taken from the answer SDP, which is
  // parsed structurally so it commits to exactly one value (a regex returned
  // whichever came first, which is what made the smuggling work).
  //
  // Why that is sound as an identity: werift verifies the DTLS handshake
  // against the fingerprint in the SDP it parses. So if the SDP declares
  // exactly one fingerprint AND the handshake completes, the peer
  // demonstrably holds that certificate. The structural parse is what makes
  // "exactly one" true; without it the SDP could say two things at once.
  let assertedFingerprint: string;
  try {
    assertedFingerprint = extractSingleFingerprint(answerSdp);
  } catch (err) {
    console.warn(
      `[PeerManager] Reconnect refused — unusable answer SDP for pairingId=${pairingId.slice(0, 8)}…: ${(err as Error).message}`,
    );
    return false;
  }

  if (!fingerprintsEqual(assertedFingerprint, paired.fingerprint)) {
    console.warn(
      `[PeerManager] Reconnect REFUSED — certificate does not match the paired device ` +
        `"${paired.alias}" (expected ${paired.fingerprint.slice(0, 17)}…, got ${assertedFingerprint.slice(0, 17)}…)`,
    );
    return false;
  }

  if (mobileFingerprint && !fingerprintsEqual(mobileFingerprint, assertedFingerprint)) {
    // Not trusted as identity, but a mismatch between what the caller CLAIMS
    // and what its certificate says is worth refusing and logging: no honest
    // client produces it.
    console.warn(
      `[PeerManager] Reconnect refused — claimed fingerprint disagrees with the certificate presented`,
    );
    return false;
  }

  try {
    await connectWithAnswer(
      stored.offerSdp,
      answerSdp,
      answerIceCandidates,
      assertedFingerprint,
      paired.alias,
      paired.deviceType,
    );
    console.log(`[PeerManager] Reconnection established with "${paired.alias}"`);
    return true;
  } catch (err) {
    console.error(`[PeerManager] Reconnection failed:`, err);
    return false;
  }
}

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
  mobileApi: boolean;
  mobileApiPort: number;
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
    mobileApi: isMobileApiRunning(),
    mobileApiPort: getMobileApiPort(),
    stateSync: isStateSyncRunning(),
    remoteTerminals: isRemoteTerminalRunning(),
    remoteAudio: isRemoteAudioRunning(),
    remoteInteraction: isRemoteInteractionRunning(),
    pushNotifications: isPushNotificationsRunning(),
  };
}
