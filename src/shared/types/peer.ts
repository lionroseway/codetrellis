/**
 * Peer and device types — Phase 9 of the CDev target architecture.
 *
 * Covers mDNS discovery, QR-based WebRTC pairing, and peer-to-peer
 * connections. These types are shared between backend and frontend.
 */

// --- Discovery ---------------------------------------------------------------

/** An mDNS-discovered CodeTrellis instance on the local network. */
export interface DiscoveredPeer {
  /** Unique instance id (random, generated once per install). */
  instanceId: string;
  /** Human-readable device name (e.g. "Saif's iMac"). */
  name: string;
  /** CodeTrellis version string. */
  version: string;
  /** DTLS fingerprint for identity verification. */
  fingerprint: string;
  /** IPv4 address on the LAN (from mDNS). */
  address: string;
  /** When this peer was last seen via mDNS (ISO). */
  lastSeen: string;
}

// --- Pairing -----------------------------------------------------------------

/**
 * A device that has been paired via the QR handshake.
 * Stored in `~/.codetrellis/paired-devices.json`.
 */
export interface PairedDevice {
  /** DTLS fingerprint — ephemeral, changes on app restart. */
  fingerprint: string;
  /**
   * Stable pairing identity — random UUID generated during pairing.
   * Survives app restarts, updates, and reinstalls. Both sides store
   * the same value. Used for reconnection auth instead of fingerprint.
   */
  pairingId: string;
  /** User-chosen alias ("Saif's iPhone", "Work Laptop"). */
  alias: string;
  /** Device type hint. */
  deviceType: 'desktop' | 'mobile' | 'unknown';
  /** When the pairing was completed (ISO). */
  pairedAt: string;
  /** Last successful connection (ISO). Null if never connected post-pairing. */
  lastConnected: string | null;
  /**
   * Shared secret for auto-reconnect (hex-encoded).
   * Derived from the DTLS handshake during initial pairing.
   * Used to authenticate reconnection offers/answers.
   */
  sharedSecret: string;
  /**
   * The mDNS instance ID of the paired device, if known.
   * Populated when a discovered peer matches a paired device's fingerprint.
   */
  instanceId: string | null;
  /**
   * What this device is allowed to ask the desktop to do
   * (Phase 19, finding 17).
   *
   * Absent on records written before capabilities existed; callers treat
   * that as DEFAULT_GRANTS, which deliberately excludes `terminal` and
   * `settings`. An old pairing therefore does NOT silently acquire a shell.
   */
  capabilities?: PeerCapabilityName[];
  /**
   * When the pairing ceremony was confirmed (ISO), if it was.
   *
   * Command-capable RPC is refused for an unconfirmed connection regardless
   * of capabilities.
   */
  confirmedAt?: string | null;
}

/** Mirrors PeerCapability in services/peer-capabilities.ts. */
export type PeerCapabilityName =
  | 'read'
  | 'write'
  | 'project'
  | 'files'
  | 'settings'
  | 'terminal';

/**
 * Pairing QR payload v5 — the desktop's parameters travel by QR.
 *
 * WHY v5 EXISTS (Phase 19, finding 18)
 *
 * v4 put only a pointer in the QR — host, port, code — and the phone FETCHED
 * the desktop's offer over plaintext HTTP. Everything it fetched was readable
 * by anyone on the network for the sixty seconds the window was open.
 *
 * A QR is a trusted out-of-band channel: the user is looking at their own
 * desktop's screen. So the parameters go IN it, including the DTLS fingerprint
 * that authenticates the desktop, and the phone rebuilds the offer locally.
 * Nothing is fetched, so nothing is exposed and nothing can be substituted.
 *
 * The phone's ANSWER still crosses the wire. That is fine: it carries its own
 * fingerprint and ICE credentials, which every DTLS handshake publishes and
 * which are worth nothing without the matching private key.
 *
 * ~200 bytes, a version-9 QR at error correction L. v4 was ~60. That growth is
 * why v4 moved AWAY from this shape, so the size is worth watching — see
 * `sdp-minimal.ts`.
 */
export interface PairingQrPayload {
  /** Payload format version. */
  v: 5;
  /**
   * Every address the desktop is reachable on (LAN, VPN), best first.
   *
   * Used for BOTH the ICE candidates and the address the answer is posted to,
   * so the phone can try each — a pairing made at a desk then still connects
   * over Tailscale.
   */
  hs: string[];
  /** Temporary pairing server TCP port (where the answer is posted). */
  p: number;
  /** 6-digit pairing code. Never sent as-is — see `PairingAnswerRequest.mac`. */
  c: string;
  /** Desktop ICE ufrag. */
  iu: string;
  /** Desktop ICE pwd. */
  ip: string;
  /** Desktop DTLS fingerprint, hex without colons, for compactness. */
  fp: string;
  /** UDP port the desktop's ICE candidates share. */
  cp: number;
  /** `a=max-message-size` from the real offer. Extracted, never guessed. */
  mms: number;
  /** Per-session random. Salts the confirmation code both devices derive. */
  n: string;
}

/**
 * Manual-entry payload — what a user can reasonably type.
 *
 * The QR path above carries ~200 bytes; nobody is typing that. So manual entry
 * keeps the v4 shape, fetching the offer over plaintext HTTP, and is the
 * WEAKER of the two paths: an observer on the network sees the handshake
 * metadata. It is still safe against an active attacker, because the
 * confirmation code the two devices derive independently will not match if
 * anything was substituted.
 *
 * It exists because simulators have no camera and some users cannot scan.
 */
export interface PairingManualEntry {
  host: string;
  port: number;
  code: string;
}

// --- Connection --------------------------------------------------------------

/** States a peer connection can be in. */
export type PeerConnectionState =
  | 'disconnected'
  | 'connecting'
  | 'connected'
  | 'reconnecting'
  | 'failed';

/** Runtime state of a connected (or recently connected) peer. */
export interface PeerConnectionInfo {
  /** Fingerprint of the paired device. */
  fingerprint: string;
  /** Alias from the paired device record. */
  alias: string;
  /** Current connection state. */
  state: PeerConnectionState;
  /** Device type. */
  deviceType: 'desktop' | 'mobile' | 'unknown';
  /** When the connection was established (ISO). Null if not connected. */
  connectedAt: string | null;
  /** Round-trip latency in ms (from heartbeat). Null if not connected. */
  latencyMs: number | null;
  /** Data channels that are open. */
  openChannels: string[];
}

// --- Data channels -----------------------------------------------------------

/**
 * Named data channels used over the WebRTC connection.
 * Each channel carries a specific kind of data.
 */
export const DATA_CHANNELS = {
  /** JSON-RPC commands, state updates, pairing lifecycle. */
  CONTROL: 'control',
  /** UI state stream (snapshots + JSON patches for the mobile WebView). */
  UI: 'ui',
  /** Terminal I/O (binary, multiplexed by terminal ID). */
  TERMINAL: 'terminal',
  /** Audio buffer forwarding (WebM/Opus chunks). */
  AUDIO: 'audio',
} as const;

export type DataChannelName = (typeof DATA_CHANNELS)[keyof typeof DATA_CHANNELS];

// --- Settings extension ------------------------------------------------------

// --- Phase 10: Multi-device sync ---------------------------------------------

/** Remote terminal info (received from a connected peer). */
export interface RemoteTerminalInfo {
  /** Terminal ID on the remote machine. */
  id: string;
  /** Agent preset (claude, codex, aider, shell). */
  preset: string;
  /** Terminal title. */
  title: string;
  /** Working directory on the remote machine. */
  cwd: string;
  /** Whether the terminal is still alive. */
  alive: boolean;
  /** Fingerprint of the peer that owns this terminal. */
  peerFingerprint: string;
  /** Alias of the peer device. */
  peerAlias: string;
  /** Index in the terminal list (for wire protocol addressing). */
  index: number;
}

/** Remote audio status from a connected peer. */
export interface RemoteAudioStatus {
  /** Fingerprint of the peer streaming audio. */
  peerFingerprint: string;
  /** Whether the peer is currently capturing audio. */
  capturing: boolean;
  /** Seconds of audio buffered on the peer. */
  bufferedSeconds: number;
}

/** A pending user-input request from a remote agent. */
export interface RemoteInputRequest {
  /** Unique ID for this request. */
  requestId: string;
  /** Fingerprint of the peer where the agent is running. */
  peerFingerprint: string;
  /** The prompt/question the agent is asking. */
  prompt: string;
  /** Options, if the agent provided them. */
  options?: string[];
  /** Plan UID context. */
  planUid?: string;
  /** Item UID context. */
  itemUid?: string;
  /** When the request was received. */
  receivedAt: number;
  /** Whether this request has been answered. */
  answered: boolean;
}

// --- Settings extension ------------------------------------------------------

/** Device-related settings added to AppSettings. */
export interface DeviceSettings {
  /**
   * Bind the mobile API on 0.0.0.0 so a phone on the LAN can reach it.
   *
   * SEPARATE from `advertise` (Phase 19, finding 1.4). Discovery and
   * exposure were one switch, and only mDNS honoured it — the listener
   * started unconditionally. Enabling one must not enable the other.
   */
  exposeMobileApi: boolean;
  /**
   * Human-readable name for this machine (shown to peers during discovery).
   * Defaults to `os.hostname()`.
   */
  deviceName: string;
  /** Whether to advertise via mDNS on startup. Default FALSE (finding A3). */
  advertise: boolean;
  /** Whether to share audio capture with paired devices. Default false. */
  shareAudio: boolean;
  /**
   * Port for the mobile API server (bound to 0.0.0.0, LAN-accessible).
   * Default 19480. If the port is in use, auto-increments until a free
   * one is found. mDNS advertises the actual port.
   */
  mobileApiPort: number;
}
