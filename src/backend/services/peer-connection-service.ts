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
  refreshDeviceFingerprint,
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
import {
  issueChallenge,
  verifyChallengeResponse,
  isUsableSecret,
  computeReconnectAnswerMac,
  computeReconnectOfferMac,
  macsEqual,
} from './peer-auth';
import { randomBytes } from 'node:crypto';
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
 * Every paired device, WITHOUT its reconnect secret.
 *
 * Phase 19, finding 15. This feeds the settings UI and an MCP tool, and the
 * secret is the one field that must never leave the backend — it is the whole
 * proof a device presents to reconnect. It was harmless while every record
 * held `''`; now that the field carries a real key, serving the record whole
 * would hand any agent with MCP access a permanent pairing credential.
 *
 * Callers that genuinely need the secret use `listPairedDevices()` directly.
 */
export function getDevices(): PublicPairedDevice[] {
  return listPairedDevices().map(redactSecret);
}

/** A paired device as it is safe to show. */
export type PublicPairedDevice = Omit<PairedDevice, 'sharedSecret'> & {
  /** Whether a usable reconnect secret exists — not the secret itself. */
  hasSecret: boolean;
};

function redactSecret(device: PairedDevice): PublicPairedDevice {
  const { sharedSecret, ...rest } = device;
  return { ...rest, hasSecret: isUsableSecret(sharedSecret) };
}

/**
 * One paired device, without its reconnect secret. See `getDevices`.
 */
export function getDevice(fingerprint: string): PublicPairedDevice | undefined {
  const device = getPairedDevice(fingerprint);
  return device ? redactSecret(device) : undefined;
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
  /** Issued with the offer, consumed with the answer. Binds the two together. */
  answerNonce: string;
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
 * Issue a reconnect challenge.
 *
 * Deliberately answers for ANY pairingId, known or not. Replying only to
 * devices that exist would make this an enumeration oracle on an endpoint
 * bound to the LAN; an unknown id gets a well-formed nonce it cannot answer.
 */
export function issueReconnectChallenge(pairingId: string): { nonce: string; expiresAt: number } {
  return issueChallenge(pairingId);
}

/** A device's answer to a reconnect challenge. */
export interface ReconnectProof {
  nonce: string;
  expiresAt: number;
  mac: string;
}

/**
 * Create a reconnection offer for a previously paired mobile device.
 *
 * AUTHENTICATION (Phase 19, finding 1.2)
 *
 * This used to accept a `pairingId` — or, failing that, a bare `fingerprint`
 * — and hand out an offer. Both are values the phone transmits in the clear
 * on every attempt, so knowing either was sufficient to be treated as the
 * paired device. The fingerprint fallback was worse still: it existed to
 * silently upgrade older clients, which meant the weaker path stayed open
 * indefinitely for everyone.
 *
 * The caller must now answer a challenge with the secret agreed at pairing.
 * The fallback is gone; a device paired before secrets existed has to pair
 * again, which is the intended cost of the change.
 */
export async function startReconnection(
  pairingId: string,
  proof: ReconnectProof,
): Promise<{
  offer: string;
  iceCandidates: string[];
  fingerprint: string;
  pairingId: string;
  answerNonce: string;
  offerMac: string;
} | null> {
  purgeStaleOffers();

  const paired = pairingId ? findByPairingId(pairingId) : undefined;

  if (!paired) {
    console.warn(`[PeerManager] Reconnect rejected — no device for pairingId=${pairingId?.slice(0, 8) ?? 'none'}`);
    return null;
  }

  if (!isUsableSecret(paired.sharedSecret)) {
    console.warn(
      `[PeerManager] Reconnect rejected — "${paired.alias}" was paired before reconnect ` +
      'authentication existed and has no secret. It must be paired again.',
    );
    return null;
  }

  const verdict = verifyChallengeResponse({
    pairingId,
    nonce: proof.nonce,
    expiresAt: proof.expiresAt,
    mac: proof.mac,
    secret: paired.sharedSecret,
  });
  if (!verdict.ok) {
    console.warn(`[PeerManager] Reconnect REFUSED for "${paired.alias}" — ${verdict.reason}`);
    return null;
  }

  const devicePairingId = paired.pairingId;
  console.log(`[PeerManager] Creating reconnect offer for "${paired.alias}" (pairingId=${devicePairingId.slice(0, 8)}…)`);

  // Create a fresh WebRTC offer
  const { offer, iceCandidates, fingerprint: desktopFp } = await createOffer();

  // Store keyed by pairingId so completeReconnection() can find it
  const answerNonce = randomBytes(16).toString('hex');
  reconnectOffers.set(devicePairingId, {
    offerSdp: offer,
    iceCandidates,
    desktopFingerprint: desktopFp,
    createdAt: Date.now(),
    answerNonce,
  });

  return {
    offer,
    iceCandidates,
    fingerprint: desktopFp,
    pairingId: devicePairingId,
    answerNonce,
    // Prove this certificate is ours. The phone cannot recognise us by the
    // fingerprint it stored at pairing — werift mints a fresh one on every
    // process start, so restarting the desktop would otherwise make every
    // paired device refuse it.
    offerMac: computeReconnectOfferMac(paired.sharedSecret, devicePairingId, proof.nonce, desktopFp),
  };
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
  answerMac = '',
): Promise<boolean> {
  const stored = reconnectOffers.get(pairingId);
  if (!stored) {
    console.warn(`[PeerManager] No pending reconnect offer for pairingId=${pairingId.slice(0, 8)}…`);
    return false;
  }

  reconnectOffers.delete(pairingId);

  const paired = findByPairingId(pairingId);
  if (!paired) return false;

  // ── IDENTITY (Phase 19, finding 2) ────────────────────────────────────
  //
  // There was NO check here at all. `mobileFingerprint` arrived in the request
  // body and was passed straight through as the peer's identity, so any caller
  // who knew a pairingId could claim to be that device. The reviewer connected
  // with a different certificate, asserted the stored fingerprint, and watched
  // all four channels open.
  //
  // WHAT THE IDENTITY IS, AND WHAT IT IS NOT
  //
  // NOT the fingerprint stored at pairing. `react-native-webrtc` mints a new
  // DTLS certificate for every `RTCPeerConnection`, so that value differs on
  // every reconnect — `PairedDevice.fingerprint` says as much, "ephemeral,
  // changes on app restart", and in practice it is per-connection. Comparing
  // against it refuses the real phone every time, which is what it did the
  // first time this ran on a device rather than against werift (which reuses
  // one certificate per process and so hid the bug completely).
  //
  // The durable identity is the SHARED SECRET, already proved by the challenge
  // that got this offer issued. On top of that, the phone signs the
  // certificate it is about to use, so an observer of this plaintext exchange
  // still cannot substitute an answer of their own: they cannot produce the
  // MAC. The certificate is read from the SDP structurally, never from the
  // body, so the SDP commits to exactly one value.
  let assertedFingerprint: string;
  try {
    assertedFingerprint = extractSingleFingerprint(answerSdp);
  } catch (err) {
    console.warn(
      `[PeerManager] Reconnect refused — unusable answer SDP for pairingId=${pairingId.slice(0, 8)}…: ${(err as Error).message}`,
    );
    return false;
  }

  if (mobileFingerprint && !fingerprintsEqual(mobileFingerprint, assertedFingerprint)) {
    // A client disagreeing with itself. No honest one produces this.
    console.warn('[PeerManager] Reconnect refused — claimed fingerprint disagrees with the certificate presented');
    return false;
  }

  if (!isUsableSecret(paired.sharedSecret)) {
    console.warn(`[PeerManager] Reconnect refused — "${paired.alias}" has no pairing secret`);
    return false;
  }

  const expectedMac = computeReconnectAnswerMac(
    paired.sharedSecret, pairingId, stored.answerNonce, assertedFingerprint,
  );
  if (!macsEqual(expectedMac, answerMac)) {
    console.warn(
      `[PeerManager] Reconnect REFUSED — the answer for "${paired.alias}" is not signed by the paired device`,
    );
    return false;
  }

  // The certificate is authenticated for THIS session. Remember it so mDNS
  // can still associate an advertisement with this device; nothing
  // authenticates against the stored value.
  refreshDeviceFingerprint(pairingId, assertedFingerprint);

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
