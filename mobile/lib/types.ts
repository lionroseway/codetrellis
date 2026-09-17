/**
 * Shared types for the mobile companion app.
 *
 * Mirrors the relevant types from the desktop's `src/shared/types/peer.ts`
 * without importing from the parent workspace (the mobile app is a
 * standalone Expo project with its own dependency tree).
 */

// --- Pairing -----------------------------------------------------------------

/**
 * Pairing QR payload v5 — the desktop's parameters travel by QR.
 *
 * Mirrors `PairingQrPayload` in the desktop's `src/shared/types/peer.ts`.
 *
 * v4 put only a pointer here — host, port, code — and this app FETCHED the
 * desktop's offer over plaintext HTTP, where anyone on the network could read
 * it for the sixty seconds the window was open (Phase 19, finding 18).
 *
 * A QR is out-of-band: the user is looking at their own desktop's screen. So
 * the parameters travel in it, including the fingerprint that authenticates
 * the desktop, and this app rebuilds the offer locally. Nothing is fetched.
 */
export interface PairingQrPayload {
  v: 5;
  /** Every address the desktop is reachable on, best first. */
  hs: string[];
  /** Temporary pairing server TCP port, where the answer is posted. */
  p: number;
  /** 6-digit pairing code. Never sent as-is — see `mac` below. */
  c: string;
  /** Desktop ICE ufrag. */
  iu: string;
  /** Desktop ICE pwd. */
  ip: string;
  /** Desktop DTLS fingerprint, hex without colons. */
  fp: string;
  /** UDP port the desktop's ICE candidates share. */
  cp: number;
  /** `a=max-message-size` from the real offer. */
  mms: number;
  /** Per-session random, salting the confirmation code. */
  n: string;
}

/**
 * Manual entry — what a user can reasonably type.
 *
 * Nobody types a 200-byte QR payload, so this keeps the v4 shape and fetches
 * the offer over plaintext HTTP. It is the WEAKER path: an observer on the
 * network sees the handshake metadata. Still safe against an active attacker,
 * because the confirmation code each device derives will not match if anything
 * was substituted.
 */
export interface PairingManualEntry {
  host: string;
  port: number;
  code: string;
}

/**
 * Response from `POST /offer` on the temp pairing server.
 *
 * Only the MANUAL-ENTRY path uses this. The QR path carries these parameters
 * in the QR itself and fetches nothing (Phase 19, finding 18).
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
  /** Stable pairing identity — survives app restarts. */
  pairingId: string;
}

/**
 * Body posted to `POST /answer` on the temp pairing server.
 */
export interface PairingAnswerRequest {
  /** Full WebRTC SDP answer. */
  answer: string;
  /** ICE candidates from the phone. */
  ice: string[];
  /** Phone's DTLS fingerprint. */
  fingerprint: string;
  /** Nonce echoed back (must match). */
  nonce: string;
  /**
   * Proof we saw the QR: HMAC over the nonce and our fingerprint, keyed by the
   * pairing code.
   *
   * The code itself used to be in this body as `c`, where anyone on the
   * network read it off the wire (Phase 19, finding 18).
   */
  mac: string;
}

/**
 * Response from `POST /answer` on the temp pairing server.
 */
export interface PairingAnswerResponse {
  accepted: boolean;
  /** Stable pairing identity — same on both sides, survives restarts. */
  pairingId: string;
}

/*
 * NO `confirmCode` HERE ANY MORE (Phase 19, finding 1.2).
 *
 * The desktop used to compute the confirmation code and send it back, and this
 * app displayed whatever arrived — so the user compared the desktop's number
 * against the desktop's number. A relay terminating both legs supplies both
 * screens, and the ceremony confirmed nothing. Each device derives its own now
 * from the certificate it actually observed; see `deriveConfirmationCode` in
 * `peer-auth.ts`.
 */

// --- Connection --------------------------------------------------------------

/** A paired desktop stored in SecureStore. */
export interface PairedDesktop {
  /** DTLS fingerprint — primary key (ephemeral, changes on restart). */
  fingerprint: string;
  /**
   * Stable pairing identity — random UUID generated during pairing.
   * Survives app restarts, updates, and reinstalls. Used for
   * reconnection auth instead of the ephemeral fingerprint.
   */
  pairingId: string;
  /** User-chosen alias ("Work iMac", "Laptop"). */
  alias: string;
  /**
   * Secret for authenticating reconnects (hex).
   *
   * Handed over by the desktop on the DTLS `control` channel at pairing time.
   * Records written before Phase 19 hold `''`, which cannot authenticate
   * anything — those desktops have to be paired again.
   */
  sharedSecret: string;
  /** When the pairing was completed (ISO). */
  pairedAt: string;
  /** Last successful connection (ISO). Null if never connected post-pairing. */
  lastConnected: string | null;
  /** LAN address from the last QR scan (may have changed). */
  lastKnownAddress: string;
  /**
   * All known reachable addresses for this desktop (LAN + Tailscale/VPN),
   * ordered LAN-first. Seeded from the QR at pair time and refreshed from the
   * desktop's snapshot on every connect. Reconnect tries each in order, which
   * is what lets a LAN pairing reconnect over a VPN without re-pairing.
   */
  candidateAddresses?: string[];
  /** Mobile API port from the last connection (default 19480). */
  lastKnownPort: number;
  /** Push notification token registered with this desktop. */
  pushToken: string | null;
}

/** Abstract connection target — WebRTC today, cloud later. */
export type ConnectionTarget =
  | { type: 'webrtc'; pairingId: string; fingerprint: string; sharedSecret: string; desktopAddress: string; mobileApiPort: number; candidateAddresses?: string[] }
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
  projectPath: string;
  itemCount: number;
  doneCount: number;
  inProgressCount: number;
  updatedAt: number | null;
}

/** Agent summary received from the desktop. */
export interface AgentSummary {
  sessionId: string;
  agentType: string;
  model: string;
  activePlanUid: string | null;
  lastSeen: number;
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

/** Presence card summary. */
export interface PresenceSummary {
  id: string;
  text: string;
  tone: string;
  createdAt: number;
  agentId?: string | null;
  linkTo?: string | null;
}

// --- v2 types (M1 enrichment) ------------------------------------------------

/** Currently open project on the desktop. */
export interface ActiveProjectSummary {
  path: string;
  displayName: string;
  branch: string | null;
}

/** A recent project from the desktop's history. */
export interface RecentProjectSummary {
  path: string;
  displayName: string;
  branch: string | null;
  pinned: boolean;
  lastOpenedAt: number;
}

/** Terminal session running on the desktop. */
export interface TerminalSummary {
  id: string;
  title: string;
  cwd: string;
  alive: boolean;
  createdAt: number;
  /** Plan 11.4 — persistent-history disk usage in bytes. Optional for
   *  back-compat with pre-11.4 desktops; falls back to 0 in UIs. */
  bytesOnDisk?: number;
}

/** Pending agent input request awaiting a human response. */
export interface InputRequestSummary {
  requestId: string;
  prompt: string;
  options?: string[];
  planUid?: string;
  receivedAt: number;
}

/** Deviation counts for attention badges. */
export interface DeviationCountsSummary {
  pending: number;
  byPlan: Array<{ planUid: string; planName: string; count: number }>;
}

/** Plan 11.1 — desktop power-service status, traveling on the state-sync
 *  snapshot so mobile reads it reactively (no 4s poll). Mirrors
 *  src/shared/types/power.ts on desktop. */
export interface PowerStatus {
  shouldBlock: boolean;
  reason: 'mobile-connected' | 'agent-active' | 'always' | null;
  ac: 'plugged' | 'battery' | 'unknown';
  platform: 'darwin' | 'win32' | 'linux' | 'web';
  updatedAt: string;
}

/** Full workspace state snapshot from the desktop (v2). */
export interface WorkspaceSnapshot {
  v: 2;
  ts: number;

  // v1 fields
  plans: PlanSummary[];
  channelEvents: ChannelEventSummary[];
  agents: AgentSummary[];
  presence: PresenceSummary[];
  audio: { capturing: boolean; bufferedSeconds: number };

  // v2 fields (M1 enrichment)
  activeProject: ActiveProjectSummary | null;
  recentProjects: RecentProjectSummary[];
  terminals: TerminalSummary[];
  pendingInputRequests: InputRequestSummary[];
  walkthroughActive: boolean;
  deviationCounts: DeviationCountsSummary;

  /**
   * Desktop's reachable IPv4 addresses (LAN + Tailscale/VPN), LAN-first.
   * Optional for back-compat with older desktops. The companion persists
   * these into the paired-desktop record so a LAN pairing auto-upgrades to
   * work over a VPN on the next reconnect — no re-pairing needed.
   */
  deviceAddresses?: string[];
  /** Plan 11.1 — runtime power-service status. Optional for back-compat
   *  with desktops on pre-11.1 builds (mobile falls back to power.status RPC). */
  powerStatus?: PowerStatus;
}

// --- Graph (M4) --------------------------------------------------------------

/** Architecture overview returned by graph.overview RPC. */
export interface GraphOverview {
  fileCount: number;
  symbolCount: number;
  importCount: number;
  topDirectories: Array<{ dir: string; fileCount: number }>;
  languageBreakdown: Array<{ language: string; count: number }>;
  symbolsByKind: Array<{ kind: string; count: number }>;
  mostImported: Array<{ path: string; importerCount: number }>;
}

/** File entry returned by graph.directory RPC. */
export interface GraphFileEntry {
  path: string;
  relativePath: string;
  language: string;
  symbolCount: number;
  importCount: number;
  importedByCount: number;
}

/** Directory listing returned by graph.directory RPC. */
export interface GraphDirectoryListing {
  dir: string;
  files: GraphFileEntry[];
  subdirectories: Array<{ name: string; fileCount: number }>;
}

/** Symbol in a file returned by graph.file RPC. */
export interface GraphSymbol {
  name: string;
  kind: string;
  startLine: number;
  endLine: number;
  modifiers: string[];
}

/** A cross-system coupling edge (HTTP / SQL / subprocess) touching a file. */
export interface CrossSystemRef {
  path: string;
  relativePath: string;
  protocol: string;
  label: string;
}

/** File detail returned by graph.file RPC. */
export interface GraphFileDetail {
  filePath: string;
  language: string;
  symbols: GraphSymbol[];
  imports: Array<{ path: string; relativePath: string; specifiers: string[] }>;
  importedBy: Array<{ path: string; relativePath: string; specifiers: string[] }>;
  /** Outgoing cross-system calls (this file → another service/route). */
  crossSystemOut: CrossSystemRef[];
  /** Incoming cross-system calls (another file → a route/query here). */
  crossSystemIn: CrossSystemRef[];
}

/** Search result returned by graph.search RPC. */
export interface GraphSearchResult {
  name: string;
  kind: string;
  filePath: string;
  relativePath: string;
  startLine: number;
  endLine: number;
}

// --- Changes / diff (M6) -----------------------------------------------------

/** Git working-tree status (from `git status --porcelain`). */
export interface GitWorkingTreeStatus {
  staged: string[];
  unstaged: string[];
  untracked: string[];
  stagedAdded: string[];
  stagedModified: string[];
  stagedDeleted: string[];
  unstagedModified: string[];
  unstagedDeleted: string[];
  commitHash: string | null;
  shortCommitHash: string | null;
}

/** Architectural diff vs the captured baseline. */
export interface ArchDiff {
  addedFiles: string[];
  removedFiles: string[];
  modifiedFiles: string[];
  blastRadius: string[];
  summary: {
    added: number;
    removed: number;
    modified: number;
    edgesAdded: number;
    edgesRemoved: number;
  };
}

/** Changes summary returned by changes.summary RPC. */
export interface ChangesSummary {
  hasBaseline: boolean;
  git: GitWorkingTreeStatus | null;
  arch: ArchDiff | null;
  /** Deduped union of changed relative paths (for badging the graph). */
  changedFiles: string[];
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
