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
  /** DTLS fingerprint — primary key for the device. */
  fingerprint: string;
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
 * QR code payload — encoded by the desktop, scanned by the mobile.
 * Contains the WebRTC offer so the mobile can create an answer.
 */
export interface PairingQrPayload {
  /** Version of the QR payload format. */
  v: 1;
  /** Pairing nonce (random, expires after 60s). */
  nonce: string;
  /** Compressed SDP offer. */
  offer: string;
  /** ICE candidates gathered via STUN. */
  ice: string[];
  /** Desktop's DTLS fingerprint. */
  fp: string;
  /** Desktop's LAN address (for ephemeral UDP answer delivery). */
  addr: string;
  /** Ephemeral UDP port the desktop listens on for the answer (open <5s). */
  port: number;
}

/**
 * Answer payload — sent from mobile to desktop during pairing.
 * Delivered via ephemeral UDP (or manual paste as fallback).
 */
export interface PairingAnswer {
  /** Must match the nonce from the QR payload. */
  nonce: string;
  /** Compressed SDP answer. */
  answer: string;
  /** Mobile's ICE candidates. */
  ice: string[];
  /** Mobile's DTLS fingerprint. */
  fp: string;
  /** 6-digit confirmation code derived from the answer. */
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
}
