/**
 * Shared types for the mobile companion app.
 *
 * Mirrors the relevant types from the desktop's `src/shared/types/peer.ts`
 * without importing from the parent workspace (the mobile app is a
 * standalone Expo project with its own dependency tree).
 */

// --- Pairing -----------------------------------------------------------------

/** QR code payload — encoded by the desktop, scanned by the mobile. */
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
  /** Ephemeral UDP port the desktop listens on for the answer. */
  port: number;
}

/** Answer payload — sent from mobile to desktop during pairing. */
export interface PairingAnswer {
  /** Must match the nonce from the QR payload. */
  nonce: string;
  /** Compressed SDP answer. */
  answer: string;
  /** Mobile's ICE candidates. */
  ice: string[];
  /** Mobile's DTLS fingerprint. */
  fp: string;
  /** 6-digit confirmation code. */
  code: string;
}

// --- Connection --------------------------------------------------------------

/** A paired desktop stored in SecureStore. */
export interface PairedDesktop {
  /** DTLS fingerprint — primary key. */
  fingerprint: string;
  /** User-chosen alias ("Work iMac", "Laptop"). */
  alias: string;
  /** Shared secret for auto-reconnect (hex-encoded). */
  sharedSecret: string;
  /** When the pairing was completed (ISO). */
  pairedAt: string;
  /** Last successful connection (ISO). Null if never connected post-pairing. */
  lastConnected: string | null;
  /** LAN address from the last QR scan (may have changed). */
  lastKnownAddress: string;
  /** Push notification token registered with this desktop. */
  pushToken: string | null;
}

/** Abstract connection target — WebRTC today, cloud later. */
export type ConnectionTarget =
  | { type: 'webrtc'; fingerprint: string; sharedSecret: string }
  | { type: 'hosted'; url: string; apiKey: string };

/** Connection states. */
export type ConnectionState =
  | 'disconnected'
  | 'connecting'
  | 'connected'
  | 'reconnecting'
  | 'failed';

// --- State sync --------------------------------------------------------------

/** Plan summary received from the desktop. */
export interface PlanSummary {
  uid: string;
  name: string;
  status: string;
  itemCount: number;
  doneCount: number;
  inProgressCount: number;
}

/** Agent summary received from the desktop. */
export interface AgentSummary {
  sessionId: string;
  agentType: string;
  model: string;
  activePlanUid: string | null;
}

/** Channel event summary. */
export interface ChannelEventSummary {
  uid: string;
  planUid: string;
  eventType: string;
  message: string;
  author: string;
  authorType: string;
  status: string;
  createdAt: number;
}

/** Full workspace state snapshot from the desktop. */
export interface WorkspaceSnapshot {
  v: 1;
  ts: number;
  plans: PlanSummary[];
  channelEvents: ChannelEventSummary[];
  agents: AgentSummary[];
  presence: Array<{ id: string; text: string; tone: string; createdAt: number }>;
  audio: { capturing: boolean; bufferedSeconds: number };
}

// --- WebView bridge ----------------------------------------------------------

/** Messages from React Native → WebView. */
export type BridgeToWebView =
  | { type: 'state-snapshot'; snapshot: WorkspaceSnapshot }
  | { type: 'state-patch'; patch: unknown[] }
  | { type: 'connection-state'; state: ConnectionState; fingerprint: string }
  | { type: 'terminal-output'; terminalIndex: number; data: string }
  | { type: 'terminal-list'; terminals: Array<{ id: string; preset: string; title: string; alive: boolean }> };

/** Messages from WebView → React Native. */
export type BridgeFromWebView =
  | { type: 'channel-event'; event: Record<string, unknown> }
  | { type: 'terminal-input'; terminalIndex: number; data: string }
  | { type: 'user-input-response'; requestId: string; response: string }
  | { type: 'navigate'; target: string; params?: Record<string, string> };
