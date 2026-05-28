/**
 * Shared types for the mobile companion app.
 *
 * Mirrors the relevant types from the desktop's `src/shared/types/peer.ts`
 * without importing from the parent workspace (the mobile app is a
 * standalone Expo project with its own dependency tree).
 */

// --- Pairing -----------------------------------------------------------------

/**
 * QR payload v4 — single QR, Bluetooth-style flow.
 *
 * The QR points the phone to a temporary pairing micro-server
 * on the desktop. Full WebRTC SDP exchange happens over HTTP on
 * that temp server, not embedded in QR codes.
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

/**
 * Response from `GET /offer?c=<code>` on the temp pairing server.
 */
export interface PairingOfferResponse {
  /** Full WebRTC SDP offer. */
  offer: string;
  /** ICE candidates from the desktop. */
  ice: string[];
  /** Desktop's DTLS fingerprint. */
  fingerprint: string;
  /** Random nonce for this pairing session. */
  nonce: string;
}

/**
 * Body posted to `POST /answer` on the temp pairing server.
 */
export interface PairingAnswerRequest {
  /** 6-digit pairing code. */
  c: string;
  /** Full WebRTC SDP answer. */
  answer: string;
  /** ICE candidates from the phone. */
  ice: string[];
  /** Phone's DTLS fingerprint. */
  fingerprint: string;
  /** Nonce echoed back (must match). */
  nonce: string;
}

/**
 * Response from `POST /answer` on the temp pairing server.
 */
export interface PairingAnswerResponse {
  accepted: boolean;
  /** Bluetooth-style 6-digit confirmation code (same on both sides). */
  confirmCode: string;
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
