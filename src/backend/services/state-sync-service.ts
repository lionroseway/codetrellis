/**
 * State sync service — Phase 10.1 of the CDev target architecture.
 *
 * Streams workspace state from this CodeTrellis instance to connected
 * peers over the WebRTC `ui` data channel:
 *
 *   1. On connection: full state snapshot (plans, agents, presence, audio).
 *   2. Ongoing: JSON patches (RFC 6902) debounced at 100ms.
 *   3. On receiving a patch from a peer: apply and re-broadcast locally.
 *
 * **What syncs** (instant, over WebRTC):
 *   - Plan list + item statuses + phase progress
 *   - Channel events (before git commit)
 *   - Agent sessions (connected agents, current tool call)
 *   - Presence (which plan is open, which item selected)
 *   - Audio capture status
 *
 * **What does NOT sync** (goes through git or stays local):
 *   - Plan content authoring (item bodies, spec docs)
 *   - Dependency graph data (each instance scans its own repo)
 *   - Settings, project config
 *
 * Deduplication: events that arrive via WebRTC and later via git are
 * matched by UID — the second arrival is a no-op.
 */

// [codemod] hoisted lazy requires → static namespace imports for bundling
import * as _lazy___audio_buffer_service from './audio-buffer-service';
import { compare as jsonPatchCompare, applyPatch } from 'fast-json-patch';
import type {
  DataChannelName,
  PeerConnectionState,
} from '../../shared/types';
import { DATA_CHANNELS } from '../../shared/types';
import {
  onChannelMessage,
  onConnectionStateChange,
  broadcastToAllPeers,
  sendToPeer,
} from './webrtc-service';
import * as sessionService from './session-service';
import * as planItemService from './plan-item-service';
import * as planService from './plan-service';
import * as channelEventService from './channel-event-service';
import * as presenceService from './presence-service';
import * as recentProjectsService from './recent-projects-service';
import * as terminalService from './terminal-service';
import * as deviationService from './deviation-service';
import * as remoteInteractionService from './remote-interaction-service';
import { getActiveProjectPath } from '../server';

// --- Types -------------------------------------------------------------------

/** The shape of the state snapshot sent over WebRTC. */
export interface SyncStateSnapshot {
  /** Schema version so the receiver can detect incompatibility. */
  v: 2;
  /** Timestamp of the snapshot (ms since epoch). */
  ts: number;

  // --- v1 fields (unchanged) ---
  /** Active plans — summaries, not full item bodies. */
  plans: PlanSummary[];
  /** Channel events — recent, sorted by recency. */
  channelEvents: ChannelEventSummary[];
  /** Connected agent sessions. */
  agents: AgentSummary[];
  /** Presence cards (ephemeral navigation narration). */
  presence: PresenceSummary[];
  /** Audio capture status. */
  audio: AudioStatusSummary;

  // --- v2 fields (M1 enrichment) ---
  /** Currently open project, or null if nothing scanned yet. */
  activeProject: ActiveProjectSummary | null;
  /** Recent projects list (pinned first, then by recency). */
  recentProjects: RecentProjectSummary[];
  /** Active terminal sessions on the desktop. */
  terminals: TerminalSummary[];
  /** Pending agent input requests awaiting a human response. */
  pendingInputRequests: InputRequestSummary[];
  /** Whether an AI walkthrough is currently active. */
  walkthroughActive: boolean;
  /** Deviation counts for attention badges. */
  deviationCounts: DeviationCountsSummary;
}

interface PlanSummary {
  uid: string;
  name: string;
  status: string;
  projectPath: string;
  itemCount: number;
  doneCount: number;
  inProgressCount: number;
  updatedAt: number | null;
}

interface ChannelEventSummary {
  uid: string;
  planUid: string;
  eventType: string;
  message: string;
  author: string;
  authorType: string;
  status: string;
  createdAt: number;
}

interface AgentSummary {
  sessionId: string;
  agentType: string;
  model: string;
  activePlanUid: string | null;
  lastSeen: number;
}

interface PresenceSummary {
  id: string;
  text: string;
  tone: string;
  createdAt: number;
}

interface AudioStatusSummary {
  capturing: boolean;
  bufferedSeconds: number;
}

// --- v2 summary types (M1) --------------------------------------------------

interface ActiveProjectSummary {
  path: string;
  displayName: string;
  branch: string | null;
}

interface RecentProjectSummary {
  path: string;
  displayName: string;
  branch: string | null;
  pinned: boolean;
  lastOpenedAt: number;
}

interface TerminalSummary {
  id: string;
  title: string;
  cwd: string;
  alive: boolean;
  createdAt: number;
}

interface InputRequestSummary {
  requestId: string;
  prompt: string;
  options?: string[];
  planUid?: string;
  receivedAt: number;
}

interface DeviationCountsSummary {
  /** Total pending deviations across all plans. */
  pending: number;
  /** Per-plan breakdown. */
  byPlan: Array<{ planUid: string; planName: string; count: number }>;
}

/** Message envelope sent on the `ui` data channel. */
interface SyncMessage {
  type: 'snapshot' | 'patch' | 'resync-request';
  /** Snapshot when type === 'snapshot'. */
  snapshot?: SyncStateSnapshot;
  /** RFC 6902 patch when type === 'patch'. */
  patch?: import('fast-json-patch').Operation[];
  /** Timestamp (ms). */
  ts: number;
  /** Source instance ID — used to avoid echo loops. */
  sourceInstanceId: string;
}

// --- State -------------------------------------------------------------------

let running = false;
let instanceId = '';
let lastSnapshot: SyncStateSnapshot | null = null;
let patchTimer: ReturnType<typeof setInterval> | null = null;
let unsubMessage: (() => void) | null = null;
let unsubConnection: (() => void) | null = null;

/** Remote state received from peers, keyed by fingerprint. */
const remoteStates = new Map<string, SyncStateSnapshot>();

/** Listeners notified when remote state changes. */
const remoteStateListeners = new Set<(fingerprint: string, state: SyncStateSnapshot) => void>();

/** Debounce interval for outbound patches (ms). */
const PATCH_DEBOUNCE_MS = 100;

/** Max channel events to include in snapshots. */
const MAX_CHANNEL_EVENTS = 50;

// --- Public API --------------------------------------------------------------

/**
 * Start the state sync service. Begins listening for peer connections
 * and broadcasting state changes.
 */
export function startStateSync(myInstanceId: string): void {
  if (running) return;
  running = true;
  instanceId = myInstanceId;

  // Listen for messages on the `ui` data channel
  unsubMessage = onChannelMessage(DATA_CHANNELS.UI, handleUiMessage);

  // Send full snapshot when a new peer connects
  unsubConnection = onConnectionStateChange(handleConnectionChange);

  // Start periodic patch broadcasting
  patchTimer = setInterval(broadcastPatchIfChanged, PATCH_DEBOUNCE_MS);

  console.log('[StateSync] Started');
}

/**
 * Stop the state sync service.
 */
export function stopStateSync(): void {
  if (!running) return;
  running = false;

  if (unsubMessage) { unsubMessage(); unsubMessage = null; }
  if (unsubConnection) { unsubConnection(); unsubConnection = null; }
  if (patchTimer) { clearInterval(patchTimer); patchTimer = null; }

  lastSnapshot = null;
  remoteStates.clear();

  console.log('[StateSync] Stopped');
}

/**
 * Get the latest state received from a specific peer.
 */
export function getRemoteState(fingerprint: string): SyncStateSnapshot | null {
  return remoteStates.get(fingerprint) ?? null;
}

/**
 * Get all remote states, keyed by fingerprint.
 */
export function getAllRemoteStates(): Map<string, SyncStateSnapshot> {
  return new Map(remoteStates);
}

/**
 * Register a listener for remote state changes.
 */
export function onRemoteStateChange(
  cb: (fingerprint: string, state: SyncStateSnapshot) => void,
): () => void {
  remoteStateListeners.add(cb);
  return () => { remoteStateListeners.delete(cb); };
}

/**
 * Whether state sync is running.
 */
export function isStateSyncRunning(): boolean {
  return running;
}

// --- Snapshot collection -----------------------------------------------------

/**
 * Collect the current workspace state into a snapshot.
 */
export function collectSnapshot(): SyncStateSnapshot {
  const plans = planService.listPlans().map((p) => {
    const items = planItemService.listAllItems(p.uid);
    return {
      uid: p.uid,
      name: p.title,
      status: p.status,
      projectPath: p.projectPath,
      itemCount: items.length,
      doneCount: items.filter((i) => i.status === 'done').length,
      inProgressCount: items.filter((i) => i.status === 'in_progress' || i.status === 'assigned').length,
      updatedAt: p.updatedAt ?? null,
    };
  });

  // Collect recent channel events from all plans
  const channelEvents: ChannelEventSummary[] = [];
  for (const plan of planService.listPlans()) {
    const events = channelEventService.listChannelEvents(plan.uid, {
      limit: MAX_CHANNEL_EVENTS,
    });
    for (const e of events) {
      channelEvents.push({
        uid: e.uid,
        planUid: e.planUid,
        eventType: e.eventType,
        message: e.payload?.message ?? '',
        author: e.author,
        authorType: e.authorType,
        status: e.status,
        createdAt: e.createdAt,
      });
    }
  }
  // Sort by recency, cap at MAX
  channelEvents.sort((a, b) => b.createdAt - a.createdAt);
  channelEvents.splice(MAX_CHANNEL_EVENTS);

  const agents = sessionService.getActiveSessions().map((s) => ({
    sessionId: s.sessionId,
    agentType: s.agentType,
    model: s.model ?? '',
    activePlanUid: s.activePlanUid ?? null,
    lastSeen: s.lastSeen,
  }));

  const presence = presenceService.getCards().map((c) => ({
    id: c.id,
    text: c.text,
    tone: c.tone,
    createdAt: c.createdAt,
  }));

  // Audio status
  let audio: AudioStatusSummary = { capturing: false, bufferedSeconds: 0 };
  try {
    const instance = _lazy___audio_buffer_service.audioBuffer;
    if (instance && typeof instance.getStatus === 'function') {
      const status = instance.getStatus();
      audio = {
        capturing: status.capturing,
        bufferedSeconds: status.bufferedSeconds,
      };
    }
  } catch { /* audio service not available */ }

  // --- v2: active project ---
  let activeProject: ActiveProjectSummary | null = null;
  try {
    const activePath = getActiveProjectPath();
    if (activePath) {
      const proj = recentProjectsService.getRecentProject(activePath);
      activeProject = {
        path: activePath,
        displayName: proj?.displayName ?? activePath.split('/').pop() ?? activePath,
        branch: proj?.branch ?? null,
      };
    }
  } catch { /* server may not have scanned yet */ }

  // --- v2: recent projects ---
  let recentProjects: RecentProjectSummary[] = [];
  try {
    recentProjects = recentProjectsService.listRecentProjects().map((p) => ({
      path: p.path,
      displayName: p.displayName,
      branch: p.branch,
      pinned: p.pinned,
      lastOpenedAt: p.lastOpenedAt,
    }));
  } catch { /* db may not be ready */ }

  // --- v2: terminals ---
  let terminals: TerminalSummary[] = [];
  try {
    terminals = terminalService.listTerminals().map((t) => ({
      id: t.id,
      title: t.title,
      cwd: t.cwd,
      alive: t.alive,
      createdAt: t.createdAt,
    }));
  } catch { /* terminal service may not be started */ }

  // --- v2: pending input requests ---
  let pendingInputRequests: InputRequestSummary[] = [];
  try {
    pendingInputRequests = remoteInteractionService.getPendingInputRequests().map((r) => ({
      requestId: r.requestId,
      prompt: r.prompt,
      options: r.options,
      planUid: r.planUid,
      receivedAt: r.receivedAt,
    }));
  } catch { /* remote interaction may not be started */ }

  // --- v2: walkthrough active ---
  const walkthroughActive = presence.length > 0;

  // --- v2: deviation counts ---
  let deviationCounts: DeviationCountsSummary = { pending: 0, byPlan: [] };
  try {
    let totalPending = 0;
    const byPlan: Array<{ planUid: string; planName: string; count: number }> = [];
    for (const plan of planService.listPlans()) {
      const devs = deviationService.getDeviations(plan.uid);
      const pendingCount = devs.filter((d) => d.resolution === 'pending').length;
      if (pendingCount > 0) {
        byPlan.push({ planUid: plan.uid, planName: plan.title, count: pendingCount });
        totalPending += pendingCount;
      }
    }
    deviationCounts = { pending: totalPending, byPlan };
  } catch { /* deviation service may not be ready */ }

  return {
    v: 2,
    ts: Date.now(),
    plans,
    channelEvents,
    agents,
    presence,
    audio,
    activeProject,
    recentProjects,
    terminals,
    pendingInputRequests,
    walkthroughActive,
    deviationCounts,
  };
}

// --- Internals: broadcasting -------------------------------------------------

function broadcastPatchIfChanged(): void {
  if (!running) return;

  const current = collectSnapshot();

  if (!lastSnapshot) {
    // First collection — store but don't broadcast (snapshot sent on connect)
    lastSnapshot = current;
    return;
  }

  // Compare and emit patch
  const patch = jsonPatchCompare(lastSnapshot, current);
  if (patch.length === 0) return;

  const msg: SyncMessage = {
    type: 'patch',
    patch,
    ts: Date.now(),
    sourceInstanceId: instanceId,
  };

  broadcastToAllPeers(DATA_CHANNELS.UI, JSON.stringify(msg));
  lastSnapshot = current;
}

function sendFullSnapshot(fingerprint: string): void {
  const snapshot = collectSnapshot();
  const msg: SyncMessage = {
    type: 'snapshot',
    snapshot,
    ts: Date.now(),
    sourceInstanceId: instanceId,
  };
  const payload = JSON.stringify(msg);
  console.log(`[StateSync] Sending full snapshot to ${fingerprint.slice(0, 12)}… (${payload.length} bytes, plans=${snapshot.plans?.length ?? 0})`);
  const sent = sendToPeer(fingerprint, DATA_CHANNELS.UI, payload);
  console.log(`[StateSync] sendToPeer returned ${sent}`);
  lastSnapshot = snapshot;
}

// --- Internals: receiving ----------------------------------------------------

function handleUiMessage(fingerprint: string, data: Buffer | string): void {
  try {
    const text = typeof data === 'string' ? data : data.toString('utf-8');
    const msg: SyncMessage = JSON.parse(text);

    // Ignore our own messages (echo prevention)
    if (msg.sourceInstanceId === instanceId) return;

    if (msg.type === 'resync-request') {
      // Mobile (or any peer) is asking for a full snapshot
      console.log(`[StateSync] Resync requested by ${fingerprint.slice(0, 12)}…`);
      sendFullSnapshot(fingerprint);
      return;
    }

    if (msg.type === 'snapshot' && msg.snapshot) {
      remoteStates.set(fingerprint, msg.snapshot);
      emitRemoteStateChange(fingerprint, msg.snapshot);
    } else if (msg.type === 'patch' && msg.patch) {
      const existing = remoteStates.get(fingerprint);
      if (existing) {
        try {
          const patched = applyPatch(
            JSON.parse(JSON.stringify(existing)),
            msg.patch,
          );
          const newState = patched.newDocument as SyncStateSnapshot;
          remoteStates.set(fingerprint, newState);
          emitRemoteStateChange(fingerprint, newState);
        } catch (err) {
          // Patch failed — request a fresh snapshot
          console.warn(`[StateSync] Patch from ${fingerprint.slice(0, 12)}… failed, requesting resync:`, err);
          requestResync(fingerprint);
        }
      } else {
        // No existing state — request full snapshot
        requestResync(fingerprint);
      }
    }
  } catch (err) {
    console.warn('[StateSync] Invalid message on ui channel:', err);
  }
}

function handleConnectionChange(fingerprint: string, state: PeerConnectionState): void {
  console.log(`[StateSync] handleConnectionChange: ${fingerprint.slice(0, 12)}… → ${state} (running=${running})`);
  if (state === 'connected') {
    // Send full snapshot — try immediately, and retry after 1s in case
    // data channels aren't open yet (SCTP negotiation lags behind DTLS).
    sendFullSnapshot(fingerprint);
    setTimeout(() => sendFullSnapshot(fingerprint), 1000);
    setTimeout(() => sendFullSnapshot(fingerprint), 3000);
  } else if (state === 'disconnected' || state === 'failed') {
    remoteStates.delete(fingerprint);
  }
}

function requestResync(fingerprint: string): void {
  const msg = JSON.stringify({
    type: 'resync-request',
    ts: Date.now(),
    sourceInstanceId: instanceId,
  });
  sendToPeer(fingerprint, DATA_CHANNELS.UI, msg);
}

function emitRemoteStateChange(fingerprint: string, state: SyncStateSnapshot): void {
  for (const cb of remoteStateListeners) {
    try { cb(fingerprint, state); } catch { /* listener error */ }
  }
}
