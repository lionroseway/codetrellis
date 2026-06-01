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
}

/**
 * Pairing QR payload v4 — single QR, Bluetooth-style flow.
 *
 * The QR just points the phone to a temporary pairing micro-server
 * that the desktop opens for ~60 seconds. Full WebRTC SDP exchange
 * happens over HTTP on the temp server, not embedded in QR codes.
 *
 * After the WebRTC connection establishes, both devices derive
 * and show a matching confirmation code (like Bluetooth SSP).
 *
 * ~50 bytes → tiny QR, very fast to scan.
 */
export interface PairingQrPayload {
  /** Version of the QR payload format (4 = temp-server). */
  v: 4;
  /** Temporary pairing server LAN address (IPv4). */
  h: string;
  /** Temporary pairing server port. */
  p: number;
  /** 6-digit pairing code (authenticates requests to the temp server). */
  c: string;
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
   * Human-readable name for this machine (shown to peers during discovery).
   * Defaults to `os.hostname()`.
   */
  deviceName: string;
  /** Whether to advertise via mDNS on startup. Default true. */
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
