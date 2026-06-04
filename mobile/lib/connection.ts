/**
 * Connection manager — abstract connection layer.
 *
 * Today: connects to a local desktop over WebRTC.
 * Future: connects to a cloud-hosted CodeTrellis over HTTPS/WebSocket.
 *
 * The connection manager handles:
 *   1. Establishing the connection (WebRTC or hosted)
 *   2. State sync (receiving snapshots and patches)
 *   3. Forwarding messages between the WebView and the desktop
 *   4. Auto-reconnect on disconnect
 */

import { router } from 'expo-router';
import { webrtc } from './webrtc';
import { touchPairedDesktop } from './storage';
import { useWorkspaceStore } from './store';
import { handleRpcResponse, cancelAllPendingRpc } from './rpc';
import type {
  ConnectionTarget,
  ConnectionState,
  WorkspaceSnapshot,
  BridgeToWebView,
} from './types';

// --- Types -------------------------------------------------------------------

type SnapshotHandler = (snapshot: WorkspaceSnapshot) => void;
type PatchHandler = (patch: unknown[]) => void;
type StateChangeHandler = (state: ConnectionState, fingerprint: string) => void;
type TerminalHandler = (index: number, data: string) => void;

// --- Connection Manager ------------------------------------------------------

class ConnectionManager {
  private target: ConnectionTarget | null = null;
  private snapshotHandlers = new Set<SnapshotHandler>();
  private patchHandlers = new Set<PatchHandler>();
  private stateHandlers = new Set<StateChangeHandler>();
  private terminalHandlers = new Set<TerminalHandler>();
  private unsubMessage: (() => void) | null = null;
  private unsubState: (() => void) | null = null;
  private currentSnapshot: WorkspaceSnapshot | null = null;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;

  /**
   * Connect to a target (desktop or hosted).
   */
  async connect(target: ConnectionTarget): Promise<void> {
    this.target = target;

    if (target.type === 'webrtc') {
      await this.connectWebRTC(target);
    } else {
      // Hosted connections — stubbed for now
      throw new Error('Hosted connections not yet implemented');
    }
  }

  /**
   * Disconnect from the current target.
   */
  disconnect(): void {
    this.cancelReconnect();

    if (this.unsubMessage) { this.unsubMessage(); this.unsubMessage = null; }
    if (this.unsubState) { this.unsubState(); this.unsubState = null; }

    cancelAllPendingRpc();
    webrtc.disconnect();
    this.target = null;
  }

  /**
   * Get the current connection state.
   */
  get state(): ConnectionState {
    return webrtc.state;
  }

  /**
   * Get the latest workspace snapshot.
   */
  get snapshot(): WorkspaceSnapshot | null {
    return this.currentSnapshot;
  }

  /**
   * Send a channel event to the connected desktop.
   */
  sendChannelEvent(eventData: Record<string, unknown>): boolean {
    return webrtc.sendControl({
      method: 'channel-event',
      params: eventData,
    });
  }

  /**
   * Send terminal input to the connected desktop.
   */
  sendTerminalInput(terminalIndex: number, data: string): boolean {
    // Wire protocol: [0x03][1-byte index][UTF-8 data]
    const buf = new Uint8Array(2 + data.length);
    buf[0] = 0x03; // TERMINAL_INPUT
    buf[1] = terminalIndex;
    const encoder = new TextEncoder();
    buf.set(encoder.encode(data), 2);
    return webrtc.send('terminal', buf.buffer);
  }

  /**
   * Respond to a user-input request from the desktop.
   */
  sendInputResponse(requestId: string, response: string): boolean {
    return webrtc.sendControl({
      method: 'user-input-response',
      params: { requestId, response },
    });
  }

  // --- Event handlers --------------------------------------------------------

  onSnapshot(handler: SnapshotHandler): () => void {
    this.snapshotHandlers.add(handler);
    return () => { this.snapshotHandlers.delete(handler); };
  }

  onPatch(handler: PatchHandler): () => void {
    this.patchHandlers.add(handler);
    return () => { this.patchHandlers.delete(handler); };
  }

  onStateChange(handler: StateChangeHandler): () => void {
    this.stateHandlers.add(handler);
    return () => { this.stateHandlers.delete(handler); };
  }

  onTerminalOutput(handler: TerminalHandler): () => void {
    this.terminalHandlers.add(handler);
    return () => { this.terminalHandlers.delete(handler); };
  }

  // --- Internals -------------------------------------------------------------

  private async connectWebRTC(target: Extract<ConnectionTarget, { type: 'webrtc' }>): Promise<void> {
    // Listen for messages from the desktop
    this.unsubMessage = webrtc.onMessage((channel, data) => {
      this.handleMessage(channel, data);
    });

    // Listen for state changes
    this.unsubState = webrtc.onStateChange((state) => {
      this.emitStateChange(state, target.fingerprint);

      if (state === 'connected') {
        touchPairedDesktop(target.fingerprint);
        this.cancelReconnect();
        // Silent pairingId upgrade: if the desktop returned a pairingId
        // during reconnect, store it so future connects use it.
        const upgradedPairingId = webrtc.lastReconnectPairingId;
        if (upgradedPairingId && upgradedPairingId !== target.pairingId) {
          console.log(`[Connection] Upgrading pairingId: ${upgradedPairingId.slice(0, 8)}…`);
          import('./storage').then(({ upsertPairedDesktop }) => {
            upsertPairedDesktop({
              fingerprint: target.fingerprint,
              pairingId: upgradedPairingId,
              alias: '', // won't overwrite — upsert merges
              sharedSecret: target.sharedSecret,
              pairedAt: '',
              lastConnected: new Date().toISOString(),
              lastKnownAddress: target.desktopAddress,
              lastKnownPort: target.mobileApiPort,
              pushToken: null,
            });
          });
        }
      } else if (state === 'disconnected' || state === 'failed') {
        this.scheduleReconnect();
      }
    });

    // Actually initiate the WebRTC reconnection.
    // The desktop's mobile API server is on a dedicated port (default 19480),
    // separate from the desktop UI server.
    // Auth: pairingId (preferred) or fingerprint (fallback for pre-upgrade clients).
    if (target.desktopAddress) {
      await webrtc.reconnectToDesktop(
        target.desktopAddress,
        target.pairingId,
        target.mobileApiPort,
        target.fingerprint, // fallback for silent pairingId upgrade
      );
    } else {
      console.warn('[Connection] No desktop address stored — cannot reconnect');
      this.emitStateChange('failed', target.fingerprint);
    }
  }

  private handleMessage(channel: string, data: string | ArrayBuffer): void {
    if (channel === 'ui') {
      this.handleUiMessage(data);
    } else if (channel === 'terminal') {
      this.handleTerminalMessage(data);
    } else if (channel === 'control') {
      this.handleControlMessage(data);
    }
  }

  private handleUiMessage(data: string | ArrayBuffer): void {
    try {
      const text = typeof data === 'string' ? data : new TextDecoder().decode(data);
      const msg = JSON.parse(text);

      if (msg.type === 'snapshot' && msg.snapshot) {
        this.currentSnapshot = msg.snapshot;
        // Push into Zustand store for reactive UI
        useWorkspaceStore.getState().applySnapshot(msg.snapshot);
        for (const handler of this.snapshotHandlers) {
          try { handler(msg.snapshot); } catch { /* */ }
        }
      } else if (msg.type === 'patch' && msg.patch) {
        // Apply patch in Zustand store
        useWorkspaceStore.getState().applyPatch(msg.patch);
        // Update local reference from store
        this.currentSnapshot = useWorkspaceStore.getState().snapshot;
        for (const handler of this.patchHandlers) {
          try { handler(msg.patch); } catch { /* */ }
        }
      }
    } catch {
      // Invalid message
    }
  }

  private handleTerminalMessage(data: string | ArrayBuffer): void {
    try {
      const buf = data instanceof ArrayBuffer ? new Uint8Array(data) : new TextEncoder().encode(data);
      if (buf.length < 3) return;

      const msgType = buf[0];
      if (msgType === 0x02) {
        // Terminal output: [0x02][1-byte index][data]
        const index = buf[1];
        const output = new TextDecoder().decode(buf.slice(2));
        for (const handler of this.terminalHandlers) {
          try { handler(index, output); } catch { /* */ }
        }
      }
    } catch {
      // Invalid terminal message
    }
  }

  private handleControlMessage(data: string | ArrayBuffer): void {
    // Check if this is an RPC response (correlated by request ID)
    if (handleRpcResponse(data)) return;

    // Desktop → mobile command (MCP drives the phone): navigate / screenshot.
    try {
      const text = typeof data === 'string' ? data : new TextDecoder().decode(data);
      const msg = JSON.parse(text);
      if (msg && msg.mcp && typeof msg.cmd === 'string') {
        void handleMobileCommand(msg);
      }
    } catch {
      // not JSON / not a command — ignore
    }
  }

  private scheduleReconnect(): void {
    if (this.reconnectTimer) return;
    if (!this.target) return;

    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      if (this.target) {
        console.log('[Connection] Attempting reconnect…');
        // Reconnect logic would go here — requires re-negotiation
        // with the desktop, which needs the desktop to be discoverable.
      }
    }, 5_000);
  }

  private cancelReconnect(): void {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
  }

  private emitStateChange(state: ConnectionState, fingerprint: string): void {
    // Push into Zustand store for reactive UI
    useWorkspaceStore.getState().setConnectionState(state, fingerprint);
    for (const handler of this.stateHandlers) {
      try { handler(state, fingerprint); } catch { /* */ }
    }
  }
}

/** Singleton instance. */
export const connection = new ConnectionManager();

// --- Desktop → mobile commands (MCP drives the phone) ------------------------

async function handleMobileCommand(msg: { cmd: string; route?: string; id?: string }): Promise<void> {
  if (msg.cmd === 'navigate' && typeof msg.route === 'string') {
    try {
      // router.navigate handles both tab routes and pushable detail routes.
      router.navigate(msg.route as never);
    } catch {
      /* invalid route — ignore */
    }
    return;
  }

  if (msg.cmd === 'screenshot' && msg.id) {
    const id = msg.id;
    try {
      // Lazily require so the JS bundle still loads in dev clients that don't
      // yet have the native module built in (screenshot just errors until then).
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const { captureScreen } = require('react-native-view-shot');
      // Downscale to a small JPEG: a full-res PNG base64 is multiple MB, which
      // silently exceeds the data channel's max message size (the send is
      // dropped, not thrown) — so the desktop just times out. A ~540px JPEG is
      // tens of KB, which we then chunk to stay well under the per-message cap.
      const data: string = await captureScreen({
        format: 'jpg',
        quality: 0.6,
        width: 540,
        result: 'base64',
      });
      const CHUNK = 8000;
      const total = Math.max(1, Math.ceil(data.length / CHUNK));
      for (let seq = 0; seq < total; seq++) {
        webrtc.sendControl({
          mcp: true,
          cmd: 'screenshot.chunk',
          id,
          seq,
          total,
          mime: 'image/jpeg',
          data: data.slice(seq * CHUNK, (seq + 1) * CHUNK),
        });
      }
    } catch (err) {
      webrtc.sendControl({
        mcp: true,
        cmd: 'screenshot.result',
        id,
        error: err instanceof Error ? err.message : String(err),
      });
    }
    return;
  }
}
