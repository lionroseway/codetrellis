/**
 * Remote agent interaction — Phase 10.4 of the CDev target architecture.
 *
 * Enables cross-device agent steering: channel events posted on one
 * device flow instantly to peers via the WebRTC `control` data channel.
 * `await_user_input` prompts from a remote device route to both local
 * UI and connected peers — first response wins.
 *
 * Wire protocol on the `control` data channel (JSON-RPC style):
 *
 *   { method: string, params: object, id?: string }
 *
 * Methods:
 *   - `channel-event`    — a channel event was posted (deliver to local)
 *   - `channel-resolved` — a channel event was resolved
 *   - `user-input-request`  — remote agent needs user input
 *   - `user-input-response` — user responded to input request
 *   - `agent-sessions`   — updated agent session list
 *   - `ping` / `pong`    — heartbeat (handled by webrtc-service)
 */

// [codemod] hoisted lazy requires → static namespace imports for bundling
import * as _lazy___push_notification_service from './push-notification-service';
import { DATA_CHANNELS } from '../../shared/types';
import {
  onChannelMessage,
  onConnectionStateChange,
  broadcastToAllPeers,
  sendToPeer,
} from './webrtc-service';
import * as sessionService from './session-service';

// --- Types -------------------------------------------------------------------

interface ControlMessage {
  method: string;
  params: Record<string, unknown>;
  id?: string;
  /** Source instance ID — prevents echo loops. */
  sourceInstanceId?: string;
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

// --- State -------------------------------------------------------------------

let running = false;
let instanceId = '';
let unsubMessage: (() => void) | null = null;
let unsubConnection: (() => void) | null = null;

/** Pending input requests from remote agents. */
const pendingInputRequests = new Map<string, RemoteInputRequest>();

/** Listeners for remote interaction events. */
const eventListeners = new Set<(event: string, data: unknown) => void>();

/** Listeners specifically for channel events received from peers. */
const channelEventListeners = new Set<(eventData: Record<string, unknown>) => void>();

// --- Public API --------------------------------------------------------------

/**
 * Start the remote interaction service.
 */
export function startRemoteInteraction(myInstanceId: string): void {
  if (running) return;
  running = true;
  instanceId = myInstanceId;

  unsubMessage = onChannelMessage(DATA_CHANNELS.CONTROL, handleControlMessage);

  unsubConnection = onConnectionStateChange((fingerprint, state) => {
    if (state === 'connected') {
      // Send our agent sessions to the newly connected peer
      sendAgentSessions(fingerprint);
    } else if (state === 'disconnected' || state === 'failed') {
      // Clean up pending requests from this peer
      for (const [id, req] of pendingInputRequests) {
        if (req.peerFingerprint === fingerprint) {
          pendingInputRequests.delete(id);
        }
      }
    }
  });

  console.log('[RemoteInteraction] Started');
}

/**
 * Stop the remote interaction service.
 */
export function stopRemoteInteraction(): void {
  if (!running) return;
  running = false;

  if (unsubMessage) { unsubMessage(); unsubMessage = null; }
  if (unsubConnection) { unsubConnection(); unsubConnection = null; }

  pendingInputRequests.clear();

  console.log('[RemoteInteraction] Stopped');
}

/**
 * Broadcast a channel event to all connected peers.
 * Called after a channel event is posted locally.
 */
export function broadcastChannelEvent(eventData: Record<string, unknown>): void {
  if (!running) return;

  const msg: ControlMessage = {
    method: 'channel-event',
    params: eventData,
    sourceInstanceId: instanceId,
  };
  broadcastToAllPeers(DATA_CHANNELS.CONTROL, JSON.stringify(msg));
}

/**
 * Broadcast that a channel event was resolved.
 */
export function broadcastChannelResolved(eventUid: string, status: string): void {
  if (!running) return;

  const msg: ControlMessage = {
    method: 'channel-resolved',
    params: { uid: eventUid, status },
    sourceInstanceId: instanceId,
  };
  broadcastToAllPeers(DATA_CHANNELS.CONTROL, JSON.stringify(msg));
}

/**
 * Broadcast a user-input request to all peers.
 * Called when an agent calls `await_user_input` on this machine.
 */
export function broadcastInputRequest(
  requestId: string,
  prompt: string,
  options?: string[],
  planUid?: string,
  itemUid?: string,
): void {
  if (!running) return;

  const msg: ControlMessage = {
    method: 'user-input-request',
    params: { requestId, prompt, options, planUid, itemUid },
    sourceInstanceId: instanceId,
  };
  broadcastToAllPeers(DATA_CHANNELS.CONTROL, JSON.stringify(msg));
}

/**
 * Send a response to a remote user-input request.
 * Called when the local user answers a prompt from a remote agent.
 */
export function respondToInputRequest(requestId: string, response: string): boolean {
  const request = pendingInputRequests.get(requestId);
  if (!request || request.answered) return false;

  request.answered = true;

  const msg: ControlMessage = {
    method: 'user-input-response',
    params: { requestId, response },
    sourceInstanceId: instanceId,
  };
  sendToPeer(request.peerFingerprint, DATA_CHANNELS.CONTROL, JSON.stringify(msg));
  pendingInputRequests.delete(requestId);

  return true;
}

/**
 * Broadcast updated agent sessions to all peers.
 * Called when agent sessions change (connect, disconnect, tool call).
 */
export function broadcastAgentSessions(): void {
  if (!running) return;

  const sessions = sessionService.getActiveSessions().map((s) => ({
    sessionId: s.sessionId,
    agentType: s.agentType,
    model: s.model ?? '',
    activePlanUid: s.activePlanUid ?? null,
    lastSeen: s.lastSeen,
  }));

  const msg: ControlMessage = {
    method: 'agent-sessions',
    params: { sessions },
    sourceInstanceId: instanceId,
  };
  broadcastToAllPeers(DATA_CHANNELS.CONTROL, JSON.stringify(msg));
}

/**
 * Get all pending input requests from remote agents.
 */
export function getPendingInputRequests(): RemoteInputRequest[] {
  return Array.from(pendingInputRequests.values()).filter((r) => !r.answered);
}

/**
 * Get a specific pending input request.
 */
export function getPendingInputRequest(requestId: string): RemoteInputRequest | null {
  return pendingInputRequests.get(requestId) ?? null;
}

/**
 * Register a listener for remote channel events received from peers.
 */
export function onRemoteChannelEvent(
  cb: (eventData: Record<string, unknown>) => void,
): () => void {
  channelEventListeners.add(cb);
  return () => { channelEventListeners.delete(cb); };
}

/**
 * Register a generic listener for remote interaction events.
 */
export function onRemoteInteractionEvent(
  cb: (event: string, data: unknown) => void,
): () => void {
  eventListeners.add(cb);
  return () => { eventListeners.delete(cb); };
}

/**
 * Whether the remote interaction service is running.
 */
export function isRemoteInteractionRunning(): boolean {
  return running;
}

// --- Internals ---------------------------------------------------------------

function sendAgentSessions(fingerprint: string): void {
  const sessions = sessionService.getActiveSessions().map((s) => ({
    sessionId: s.sessionId,
    agentType: s.agentType,
    model: s.model ?? '',
    activePlanUid: s.activePlanUid ?? null,
    lastSeen: s.lastSeen,
  }));

  const msg: ControlMessage = {
    method: 'agent-sessions',
    params: { sessions },
    sourceInstanceId: instanceId,
  };
  sendToPeer(fingerprint, DATA_CHANNELS.CONTROL, JSON.stringify(msg));
}

function handleControlMessage(fingerprint: string, data: Buffer | string): void {
  try {
    const text = typeof data === 'string' ? data : data.toString('utf-8');
    const msg: ControlMessage = JSON.parse(text);

    // Ignore echo
    if (msg.sourceInstanceId === instanceId) return;

    // Ignore heartbeat messages (handled by webrtc-service)
    if (msg.method === 'ping' || msg.method === 'pong') return;
    // Also handle the raw { type: 'ping' } format from webrtc-service heartbeat
    if ((msg as any).type === 'ping' || (msg as any).type === 'pong') return;

    switch (msg.method) {
      case 'channel-event': {
        // A channel event from a peer — notify local listeners
        for (const cb of channelEventListeners) {
          try { cb(msg.params); } catch { /* listener error */ }
        }
        emitEvent('remote-channel-event', { fingerprint, event: msg.params });
        break;
      }

      case 'channel-resolved': {
        emitEvent('remote-channel-resolved', { fingerprint, ...msg.params });
        break;
      }

      case 'user-input-request': {
        const { requestId, prompt, options, planUid, itemUid } = msg.params as {
          requestId: string; prompt: string; options?: string[];
          planUid?: string; itemUid?: string;
        };
        if (requestId && prompt) {
          const request: RemoteInputRequest = {
            requestId,
            peerFingerprint: fingerprint,
            prompt,
            options,
            planUid,
            itemUid,
            receivedAt: Date.now(),
            answered: false,
          };
          pendingInputRequests.set(requestId, request);
          emitEvent('remote-input-request', request);
        }
        break;
      }

      case 'user-input-response': {
        // Response from a peer to our local input request
        const { requestId, response } = msg.params as {
          requestId: string; response: string;
        };
        emitEvent('remote-input-response', { requestId, response, fingerprint });
        break;
      }

      case 'agent-sessions': {
        const { sessions } = msg.params as { sessions: unknown[] };
        emitEvent('remote-agent-sessions', { fingerprint, sessions });
        break;
      }

      case 'register-push-token': {
        // Mobile device sending its Expo Push Token
        const { token } = msg.params as { token: string };
        if (token) {
          // Lazy import to avoid circular dependency
          const { registerPushToken } = _lazy___push_notification_service;
          registerPushToken(fingerprint, token);
        }
        break;
      }

      default:
        // Unknown method — ignore
        break;
    }
  } catch (err) {
    console.warn('[RemoteInteraction] Invalid control message:', err);
  }
}

function emitEvent(event: string, data: unknown): void {
  for (const cb of eventListeners) {
    try { cb(event, data); } catch { /* listener error */ }
  }
}
