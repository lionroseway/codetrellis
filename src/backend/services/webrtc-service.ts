/**
 * WebRTC connection service — Phase 9.3 of the CDev target architecture.
 *
 * Manages WebRTC peer connections using `werift` (pure TypeScript,
 * no native deps). Handles:
 *
 *   - Offer/answer creation with ICE gathering via STUN
 *   - Data channel setup (control, ui, terminal, audio)
 *   - Connection lifecycle (connect, heartbeat, reconnect)
 *   - One RTCPeerConnection per active peer
 *
 * Uses `werift` instead of `node-datachannel` to avoid adding
 * another native dependency alongside `node-pty`.
 */

import { RTCPeerConnection, RTCSessionDescription } from 'werift';
import { randomBytes } from 'node:crypto';
import type {
  PeerConnectionInfo,
  PeerConnectionState,
  DataChannelName,
} from '../../shared/types';
import { DATA_CHANNELS } from '../../shared/types';

// --- Constants ---------------------------------------------------------------

/** Google's public STUN servers for ICE candidate gathering. */
const DEFAULT_STUN_SERVERS = [
  'stun:stun.l.google.com:19302',
  'stun:stun1.l.google.com:19302',
];

/** Heartbeat interval on the control channel. */
const HEARTBEAT_INTERVAL_MS = 10_000;

/** Missed heartbeats before connection is presumed dead. */
const MAX_MISSED_HEARTBEATS = 3;

/** Max time to wait for ICE gathering to complete. */
const ICE_GATHERING_TIMEOUT_MS = 10_000;

// --- Types -------------------------------------------------------------------

interface DataChannelWrapper {
  name: DataChannelName;
  channel: ReturnType<RTCPeerConnection['createDataChannel']>;
  onMessage: Set<(data: Buffer | string) => void>;
}

interface PeerEntry {
  fingerprint: string;
  alias: string;
  deviceType: 'desktop' | 'mobile' | 'unknown';
  pc: RTCPeerConnection;
  channels: Map<string, DataChannelWrapper>;
  state: PeerConnectionState;
  connectedAt: Date | null;
  lastHeartbeat: number;
  missedHeartbeats: number;
  heartbeatTimer: ReturnType<typeof setInterval> | null;
}

// --- State -------------------------------------------------------------------

const peers = new Map<string, PeerEntry>();
const connectionListeners = new Set<(fingerprint: string, state: PeerConnectionState) => void>();
const messageListeners = new Map<string, Set<(fingerprint: string, data: Buffer | string) => void>>();

/**
 * Pending offer PC — kept alive between `createOffer()` and
 * `connectWithAnswer()` so the DTLS certificate (and therefore
 * fingerprint) remains the same. If we closed and re-created the PC,
 * the new certificate wouldn't match the fingerprint encoded in the
 * QR code, and the DTLS handshake would fail.
 */
let pendingOfferPc: RTCPeerConnection | null = null;

/** Clean up the pending offer PC. */
export async function discardPendingOffer(): Promise<void> {
  if (pendingOfferPc) {
    try { await pendingOfferPc.close(); } catch { /* */ }
    pendingOfferPc = null;
  }
}

// --- Public API: Offer/Answer ------------------------------------------------

/**
 * Create a WebRTC offer for a new pairing. Gathers ICE candidates
 * via STUN and returns the SDP + candidates.
 *
 * The RTCPeerConnection is kept alive (not closed) so that
 * `connectWithAnswer()` can reuse it with the same DTLS certificate.
 * The fingerprint in the QR code must match the certificate
 * presented during the DTLS handshake.
 *
 * @returns The SDP offer string and ICE candidate strings, plus the
 *          DTLS fingerprint for identity.
 */
export async function createOffer(): Promise<{
  offer: string;
  iceCandidates: string[];
  fingerprint: string;
}> {
  // Clean up any previous pending offer
  await discardPendingOffer();

  const pc = new RTCPeerConnection({
    iceServers: DEFAULT_STUN_SERVERS.map((url) => ({ urls: url })),
  });

  // Create a dummy data channel so that ICE gathering includes data.
  pc.createDataChannel('_init');

  const offer = await pc.createOffer();
  await pc.setLocalDescription(offer);

  // Wait for ICE gathering to complete (or timeout).
  const candidates = await gatherIceCandidates(pc);

  const fingerprint = extractFingerprint(pc);

  // Keep the PC alive — connectWithAnswer() will reuse it so the
  // DTLS certificate matches the fingerprint in the QR code.
  pendingOfferPc = pc;

  return {
    offer: offer.sdp,
    iceCandidates: candidates,
    fingerprint,
  };
}

/**
 * Complete a WebRTC connection from the desktop side (initiator).
 * Takes the answer from the peer, sets up data channels, starts heartbeat.
 *
 * @param answerSdp  The SDP answer from the peer.
 * @param peerIceCandidates  ICE candidates from the peer.
 * @param peerFingerprint  The peer's DTLS fingerprint.
 * @param alias  Human-readable name for the peer.
 * @param deviceType  Desktop or mobile.
 */
export async function connectWithAnswer(
  offerSdp: string,
  answerSdp: string,
  _peerIceCandidates: string[],
  peerFingerprint: string,
  alias: string,
  deviceType: 'desktop' | 'mobile' | 'unknown',
): Promise<PeerEntry> {
  // Reuse the pending offer PC to preserve the DTLS certificate
  // whose fingerprint was encoded in the QR code. If the PC were
  // re-created, the new certificate would have a different fingerprint
  // and the DTLS handshake would fail.
  let pc: RTCPeerConnection;
  let reusingPending = false;

  if (pendingOfferPc) {
    pc = pendingOfferPc;
    pendingOfferPc = null;
    reusingPending = true;
    console.log('[WebRTC] Reusing pending offer PC (same DTLS certificate)');
  } else {
    console.warn('[WebRTC] No pending offer PC — creating fresh connection (fingerprint may differ)');
    pc = new RTCPeerConnection({
      iceServers: DEFAULT_STUN_SERVERS.map((url) => ({ urls: url })),
    });
  }

  const entry: PeerEntry = {
    fingerprint: peerFingerprint,
    alias,
    deviceType,
    pc,
    channels: new Map(),
    state: 'connecting',
    connectedAt: null,
    lastHeartbeat: Date.now(),
    missedHeartbeats: 0,
    heartbeatTimer: null,
  };

  peers.set(peerFingerprint, entry);
  emitConnectionState(peerFingerprint, 'connecting');

  // Create data channels (the _init channel from createOffer is harmless)
  for (const channelName of Object.values(DATA_CHANNELS)) {
    createChannel(entry, channelName);
  }

  // If reusing the pending PC, the local description (offer) is already
  // set — we only need to set the remote description (answer).
  // The answer SDP includes the peer's ICE candidate inline (added by
  // reconstructAnswerSdp), so no explicit addIceCandidate needed.
  if (!reusingPending) {
    await pc.setLocalDescription(
      new RTCSessionDescription(offerSdp, 'offer'),
    );
  }
  await pc.setRemoteDescription(
    new RTCSessionDescription(answerSdp, 'answer'),
  );

  // Monitor connection state
  pc.connectionStateChange.subscribe((state: string) => {
    handleConnectionStateChange(entry, state);
  });

  // Start heartbeat
  startHeartbeat(entry);

  return entry;
}

/**
 * Create a WebRTC answer (called by the receiving side during pairing).
 */
export async function createAnswer(
  offerSdp: string,
  offerIceCandidates: string[],
): Promise<{
  answer: string;
  iceCandidates: string[];
  fingerprint: string;
}> {
  const pc = new RTCPeerConnection({
    iceServers: DEFAULT_STUN_SERVERS.map((url) => ({ urls: url })),
  });

  await pc.setRemoteDescription(
    new RTCSessionDescription(offerSdp, 'offer'),
  );

  const answer = await pc.createAnswer();
  await pc.setLocalDescription(answer);

  const candidates = await gatherIceCandidates(pc);
  const fingerprint = extractFingerprint(pc);

  await pc.close();

  return {
    answer: answer.sdp,
    iceCandidates: candidates,
    fingerprint,
  };
}

// --- Public API: Data Channels -----------------------------------------------

/**
 * Send data on a named channel to a specific peer.
 */
export function sendToPeer(
  fingerprint: string,
  channelName: DataChannelName,
  data: string | Buffer,
): boolean {
  const entry = peers.get(fingerprint);
  if (!entry || entry.state !== 'connected') return false;

  const wrapper = entry.channels.get(channelName);
  if (!wrapper) return false;

  try {
    if (typeof data === 'string') {
      wrapper.channel.send(Buffer.from(data, 'utf-8'));
    } else {
      wrapper.channel.send(data);
    }
    return true;
  } catch (err) {
    console.warn(`[WebRTC] Failed to send on ${channelName} to ${fingerprint.slice(0, 12)}:`, err);
    return false;
  }
}

/**
 * Broadcast data on a named channel to all connected peers.
 */
export function broadcastToAllPeers(
  channelName: DataChannelName,
  data: string | Buffer,
): number {
  let sent = 0;
  for (const [fp] of peers) {
    if (sendToPeer(fp, channelName, data)) sent++;
  }
  return sent;
}

/**
 * Register a listener for messages on a named channel from any peer.
 */
export function onChannelMessage(
  channelName: DataChannelName,
  cb: (fingerprint: string, data: Buffer | string) => void,
): () => void {
  let set = messageListeners.get(channelName);
  if (!set) {
    set = new Set();
    messageListeners.set(channelName, set);
  }
  set.add(cb);
  return () => { set!.delete(cb); };
}

/**
 * Register a listener for connection state changes.
 */
export function onConnectionStateChange(
  cb: (fingerprint: string, state: PeerConnectionState) => void,
): () => void {
  connectionListeners.add(cb);
  return () => { connectionListeners.delete(cb); };
}

// --- Public API: Connection Management ---------------------------------------

/**
 * Get info about all active/recent peer connections.
 */
export function getPeerConnections(): PeerConnectionInfo[] {
  return Array.from(peers.values()).map((entry) => ({
    fingerprint: entry.fingerprint,
    alias: entry.alias,
    state: entry.state,
    deviceType: entry.deviceType,
    connectedAt: entry.connectedAt?.toISOString() ?? null,
    latencyMs: null, // TODO: measure round-trip on heartbeat
    openChannels: Array.from(entry.channels.keys()),
  }));
}

/**
 * Get info about a specific peer connection.
 */
export function getPeerConnection(fingerprint: string): PeerConnectionInfo | undefined {
  const entry = peers.get(fingerprint);
  if (!entry) return undefined;

  return {
    fingerprint: entry.fingerprint,
    alias: entry.alias,
    state: entry.state,
    deviceType: entry.deviceType,
    connectedAt: entry.connectedAt?.toISOString() ?? null,
    latencyMs: null,
    openChannels: Array.from(entry.channels.keys()),
  };
}

/**
 * Disconnect a specific peer.
 */
export async function disconnectPeer(fingerprint: string): Promise<void> {
  const entry = peers.get(fingerprint);
  if (!entry) return;

  stopHeartbeat(entry);

  try {
    await entry.pc.close();
  } catch { /* already closed */ }

  entry.state = 'disconnected';
  emitConnectionState(fingerprint, 'disconnected');
  peers.delete(fingerprint);

  console.log(`[WebRTC] Disconnected peer: ${entry.alias} (${fingerprint.slice(0, 12)}…)`);
}

/**
 * Disconnect all peers. Called during shutdown.
 */
export async function disconnectAllPeers(): Promise<void> {
  const fingerprints = Array.from(peers.keys());
  await Promise.all(fingerprints.map((fp) => disconnectPeer(fp)));
}

/**
 * Number of currently connected peers.
 */
export function connectedPeerCount(): number {
  let count = 0;
  for (const entry of peers.values()) {
    if (entry.state === 'connected') count++;
  }
  return count;
}

// --- Internals ---------------------------------------------------------------

function createChannel(entry: PeerEntry, name: DataChannelName): void {
  const channel = entry.pc.createDataChannel(name, {
    ordered: true,
  });

  const wrapper: DataChannelWrapper = {
    name,
    channel,
    onMessage: new Set(),
  };

  // werift emits the data directly (string | Buffer), not wrapped in an object
  channel.onMessage.subscribe((data: string | Buffer) => {
    // Dispatch to channel-level listeners
    const listeners = messageListeners.get(name);
    if (listeners) {
      for (const cb of listeners) {
        try { cb(entry.fingerprint, data); } catch { /* listener error */ }
      }
    }
    // Dispatch to wrapper-level listeners
    for (const cb of wrapper.onMessage) {
      try { cb(data); } catch { /* listener error */ }
    }
  });

  entry.channels.set(name, wrapper);
}

function handleConnectionStateChange(entry: PeerEntry, state: string): void {
  switch (state) {
    case 'connected':
      entry.state = 'connected';
      entry.connectedAt = new Date();
      console.log(`[WebRTC] Connected to ${entry.alias} (${entry.fingerprint.slice(0, 12)}…)`);
      break;
    case 'disconnected':
    case 'closed':
      entry.state = 'disconnected';
      stopHeartbeat(entry);
      console.log(`[WebRTC] Disconnected from ${entry.alias}`);
      break;
    case 'failed':
      entry.state = 'failed';
      stopHeartbeat(entry);
      console.log(`[WebRTC] Connection failed to ${entry.alias}`);
      break;
  }
  emitConnectionState(entry.fingerprint, entry.state);
}

function startHeartbeat(entry: PeerEntry): void {
  stopHeartbeat(entry);

  entry.heartbeatTimer = setInterval(() => {
    if (entry.state !== 'connected' && entry.state !== 'connecting') {
      stopHeartbeat(entry);
      return;
    }

    // Send ping on control channel
    const pingId = randomBytes(4).toString('hex');
    const sent = sendToPeer(entry.fingerprint, DATA_CHANNELS.CONTROL,
      JSON.stringify({ type: 'ping', id: pingId, ts: Date.now() }),
    );

    if (!sent) {
      entry.missedHeartbeats++;
    }

    if (entry.missedHeartbeats >= MAX_MISSED_HEARTBEATS) {
      console.warn(`[WebRTC] ${entry.alias}: ${MAX_MISSED_HEARTBEATS} heartbeats missed — connection presumed dead`);
      entry.state = 'failed';
      emitConnectionState(entry.fingerprint, 'failed');
      stopHeartbeat(entry);
    }
  }, HEARTBEAT_INTERVAL_MS);
}

function stopHeartbeat(entry: PeerEntry): void {
  if (entry.heartbeatTimer) {
    clearInterval(entry.heartbeatTimer);
    entry.heartbeatTimer = null;
  }
}

function emitConnectionState(fingerprint: string, state: PeerConnectionState): void {
  for (const cb of connectionListeners) {
    try { cb(fingerprint, state); } catch { /* listener error */ }
  }
}

/**
 * Wait for ICE gathering to complete, up to a timeout.
 * Returns the gathered ICE candidate strings.
 */
async function gatherIceCandidates(pc: RTCPeerConnection): Promise<string[]> {
  const candidates: string[] = [];

  return new Promise<string[]>((resolve) => {
    const timeout = setTimeout(() => {
      resolve(candidates);
    }, ICE_GATHERING_TIMEOUT_MS);

    pc.onIceCandidate.subscribe((candidate) => {
      if (candidate) {
        candidates.push(JSON.stringify(candidate));
      }
    });

    // If gathering state changes to complete, resolve immediately
    const checkComplete = () => {
      if (pc.iceGatheringState === 'complete') {
        clearTimeout(timeout);
        resolve(candidates);
      }
    };
    // Check periodically since werift may not have a direct event
    const interval = setInterval(checkComplete, 100);
    setTimeout(() => clearInterval(interval), ICE_GATHERING_TIMEOUT_MS);
  });
}

/**
 * Extract the DTLS fingerprint from a peer connection.
 */
function extractFingerprint(pc: RTCPeerConnection): string {
  try {
    // werift exposes the local certificate fingerprint
    const desc = pc.localDescription;
    if (desc?.sdp) {
      // Parse fingerprint from SDP: a=fingerprint:sha-256 XX:XX:XX...
      const match = desc.sdp.match(/a=fingerprint:sha-256\s+([0-9A-Fa-f:]+)/);
      if (match) return match[1];
    }
  } catch { /* fall through */ }

  // Fallback: generate a random one (shouldn't happen in practice)
  return randomBytes(32).toString('hex').replace(/(.{2})/g, '$1:').slice(0, -1).toUpperCase();
}
