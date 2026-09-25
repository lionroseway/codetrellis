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
import { AppState, type AppStateStatus } from 'react-native';
import NetInfo, { type NetInfoState } from '@react-native-community/netinfo';
import { webrtc, isRepairRequired } from './webrtc';
import { recordConnect, mergeCandidateAddresses } from './storage';
import { useWorkspaceStore } from './store';
import { handleRpcResponse, cancelAllPendingRpc, rpc } from './rpc';
import { previewTransfers } from './approvals';
import { getDiscoveredDesktops } from './discovery';
import { notePushAck } from './push';
import { log as diagLog } from './diagnostics';
import type {
  ConnectionTarget,
  ConnectionState,
  WorkspaceSnapshot,
} from './types';

// --- Types -------------------------------------------------------------------

type SnapshotHandler = (snapshot: WorkspaceSnapshot) => void;
type PatchHandler = (patch: unknown[]) => void;
type StateChangeHandler = (state: ConnectionState, fingerprint: string) => void;
type TerminalHandler = (index: number, data: string) => void;

/** How long we keep auto-reconnecting before surfacing a terminal disconnect
 *  (which returns the user to the device list). Generous on purpose — only a
 *  genuinely-gone desktop should ever reach it. */
const RECONNECT_GIVEUP_MS = 90_000;

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
  private reconnectAttempts = 0;
  private reconnecting = false;
  private heartbeatTimer: ReturnType<typeof setInterval> | null = null;
  private missedPings = 0;
  private lastInboundAt = 0;
  private pinging = false;
  private appStateSub: { remove: () => void } | null = null;
  /** NetInfo subscription — fires on wifi↔cellular handoffs, VPN flips,
   *  isInternetReachable transitions while the app is foreground-active.
   *  Plan item 5.2. */
  private netInfoUnsub: (() => void) | null = null;
  /** Last NetInfo state we acted on — used to coalesce duplicate events. */
  private lastNetInfoType: string | null = null;
  private lastNetInfoReachable: boolean | null = null;
  /** True after a deliberate user disconnect — suppresses all auto-reconnect. */
  private userDisconnected = false;
  /** True once we've reached a live connection for the current target — lets us
   *  label a later drop as `reconnecting` (we had it) vs first-time `connecting`. */
  private everConnected = false;
  /** When the current outage began (epoch ms; 0 = connected). Drives the give-up
   *  ceiling so a truly-gone desktop eventually returns the user to the device
   *  list — but a normal blip never does. */
  private outageStartedAt = 0;
  /** Set once we've given up auto-reconnecting (ceiling hit) — surfaces a
   *  terminal `disconnected` and stops the retry loop until the next connect(). */
  private gaveUp = false;
  /** Snapshot-pull retry (rides out slow VPN convergence + reconnect bounces). */
  private resyncTimer: ReturnType<typeof setTimeout> | null = null;
  private resyncAttempts = 0;

  /**
   * Connect to a target (desktop or hosted).
   */
  async connect(target: ConnectionTarget): Promise<void> {
    this.userDisconnected = false;
    this.everConnected = false;
    this.outageStartedAt = 0;
    this.gaveUp = false;
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
    this.userDisconnected = true;
    this.everConnected = false;
    this.outageStartedAt = 0;
    this.gaveUp = false;
    this.cancelReconnect();
    this.cancelHydration();
    this.stopHeartbeat();
    this.reconnectAttempts = 0;
    this.reconnecting = false;
    if (this.appStateSub) { this.appStateSub.remove(); this.appStateSub = null; }
    if (this.netInfoUnsub) { this.netInfoUnsub(); this.netInfoUnsub = null; }
    this.lastNetInfoType = null;
    this.lastNetInfoReachable = null;

    if (this.unsubMessage) { this.unsubMessage(); this.unsubMessage = null; }
    if (this.unsubState) { this.unsubState(); this.unsubState = null; }

    cancelAllPendingRpc();
    previewTransfers.cancelAll();
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
    // Re-link when the app returns to the foreground — iOS suspends the app in
    // the background, which silently kills the WebRTC transport. (Registered
    // once; persists across reconnects.)
    if (!this.appStateSub) {
      this.appStateSub = AppState.addEventListener('change', (s) => this.handleAppState(s));
    }
    // Plan item 5.2 — proactively reconnect on network handoffs
    // (wifi↔cellular, VPN flip, isInternetReachable transitions).
    // Without this the user eats up to ~30s of stalled RPCs while
    // the heartbeat catches the dead transport.
    if (!this.netInfoUnsub) {
      this.netInfoUnsub = NetInfo.addEventListener((s) => this.handleNetInfo(s));
    }

    // Listen for messages from the desktop
    this.unsubMessage = webrtc.onMessage((channel, data) => {
      this.handleMessage(channel, data);
    });

    // Listen for state changes
    this.unsubState = webrtc.onStateChange((state) => {
      this.emitStateChange(state, target.fingerprint);

      if (state === 'connected') {
        this.everConnected = true;
        this.outageStartedAt = 0; // recovered → reset the give-up clock
        this.gaveUp = false;
        this.cancelReconnect();
        this.reconnectAttempts = 0;
        this.reconnecting = false;
        this.missedPings = 0;
        this.lastInboundAt = Date.now();
        this.startHeartbeat();
        // Pull a fresh snapshot until we're actually hydrated. The desktop only
        // pushes one in the first ~3s after connect; over a slow-to-converge VPN
        // (or after a 4G↔5G / VPN-drop bounce) that push can be missed, leaving
        // the UI empty forever. Re-runs on every (re)connect → bounce-resilient.
        this.startHydration();

        // Make the address that actually worked sticky (handles LAN churn and
        // an off-LAN VPN connect), and silently upgrade the pairingId if the
        // desktop returned a new one. recordConnect() only touches these
        // fields — it won't blank the alias or other untouched values.
        const workingAddress = webrtc.lastReconnectAddress || target.desktopAddress;
        const upgradedPairingId = webrtc.lastReconnectPairingId;
        const pairingIdChanged = !!upgradedPairingId && upgradedPairingId !== target.pairingId;
        if (workingAddress) target.desktopAddress = workingAddress;
        if (pairingIdChanged) {
          console.log(`[Connection] Upgrading pairingId: ${upgradedPairingId!.slice(0, 8)}…`);
          target.pairingId = upgradedPairingId!;
        }
        recordConnect(
          { pairingId: target.pairingId || undefined, fingerprint: target.fingerprint },
          {
            lastKnownAddress: workingAddress,
            lastKnownPort: target.mobileApiPort,
            pairingId: pairingIdChanged ? upgradedPairingId! : undefined,
          },
        ).catch(() => { /* best-effort persistence */ });
      } else if (state === 'reconnecting' || state === 'disconnected' || state === 'failed') {
        // Transient transport states (blip, ICE drop, candidate-sweep failure) —
        // keep the user where they are and try to recover. Only the give-up
        // ceiling inside scheduleReconnect surfaces a terminal disconnect.
        this.scheduleReconnect();
      }
    });

    // Actually initiate the WebRTC reconnection.
    // The desktop's mobile API server is on a dedicated port (default 19480),
    // separate from the desktop UI server.
    //
    // Auth: a challenge-response over the secret agreed at pairing. The
    // fingerprint is no longer an alternative credential — it is what we PIN
    // the desktop's offer against, so whatever answers on this address has to
    // be the machine we paired with (Phase 19, findings 1.2 and 2).
    //
    // Address: try every known candidate (live mDNS hit, stored LAN +
    // Tailscale) so a pairing made on the LAN also connects over a VPN.
    const candidates = this.resolveCandidates(target);
    if (candidates.length > 0) {
      await webrtc.reconnectToDesktop(
        candidates,
        target.pairingId,
        target.mobileApiPort,
        target.fingerprint,
        target.sharedSecret,
      );
    } else {
      console.warn('[Connection] No reachable address for desktop — cannot reconnect');
      this.emitStateChange('failed', target.fingerprint);
    }
  }

  private handleMessage(channel: string, data: string | ArrayBuffer): void {
    // Any inbound message proves the peer is alive — feeds the liveness check.
    this.lastInboundAt = Date.now();
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
        this.cancelHydration(); // hydrated — stop pulling
        // Auto-upgrade: learn the desktop's full address list (LAN + Tailscale)
        // so a pairing made on the LAN can reconnect over a VPN next time.
        this.absorbDeviceAddresses(msg.snapshot);
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

    try {
      const text = typeof data === 'string' ? data : new TextDecoder().decode(data);
      const msg = JSON.parse(text);
      // Desktop liveness ping → reply with a pong so the desktop can detect
      // when WE go away and reap the dead peer. Without this the desktop's
      // sends succeed into a killed socket and the peer lingers forever.
      if (msg && msg.type === 'ping') {
        webrtc.sendControl({ type: 'pong', id: msg.id, ts: Date.now() });
        return;
      }
      // Desktop confirms it stored our push token → close the bind loop so the
      // notification settings screen can show "bound", not just "sent".
      if (msg && msg.method === 'push-token-ack') {
        notePushAck();
        return;
      }
      // A piece of a preview we asked for (Phase 31 §12). Only ids we are
      // waiting on are taken; anything else falls through and is ignored.
      if (msg && msg.mcp && previewTransfers.accept(msg)) return;
      // Desktop → mobile command (MCP drives the phone): navigate / screenshot.
      if (msg && msg.mcp && typeof msg.cmd === 'string') {
        void handleMobileCommand(msg);
      }
    } catch {
      // not JSON / not a command — ignore
    }
  }

  // --- Liveness heartbeat ----------------------------------------------------
  // WebRTC's connectionState can lag (or not fire) when the desktop process
  // dies, leaving the phone showing a stale "Connected". An active ping over
  // the control channel detects a dead peer within a few seconds and kicks off
  // reconnection.

  private startHeartbeat(): void {
    this.stopHeartbeat();
    this.heartbeatTimer = setInterval(() => { void this.pingLiveness(); }, 10_000);
  }

  private stopHeartbeat(): void {
    if (this.heartbeatTimer) { clearInterval(this.heartbeatTimer); this.heartbeatTimer = null; }
  }

  private async pingLiveness(): Promise<void> {
    if (this.reconnecting || this.pinging) return;
    // If we've heard from the desktop recently (snapshots, patches, any reply),
    // it's alive — skip the probe. This keeps a busy/healthy connection from
    // ever false-positiving into a reconnect (which would spawn a duplicate peer).
    if (Date.now() - this.lastInboundAt < 12_000) { this.missedPings = 0; return; }

    this.pinging = true;
    try {
      // Cheap, side-effect-free RPC. A reply (even an error) proves the channel
      // is alive; only a timeout / closed channel counts as a miss.
      await rpc('project.active', {}, 8_000);
      this.missedPings = 0;
    } catch {
      this.missedPings += 1;
      // ~3 quiet, unanswered probes (>30s of silence) before treating the peer
      // as dead — conservative enough to avoid churn, fast enough to recover.
      if (this.missedPings >= 3) {
        this.missedPings = 0;
        console.log('[Connection] Liveness lost — peer not responding, reconnecting');
        this.stopHeartbeat();
        if (this.target && this.target.type === 'webrtc') {
          // Recovering, not gone — keep the user on screen while we reconnect.
          this.emitStateChange('reconnecting', this.target.fingerprint);
        }
        this.scheduleReconnect();
      }
    } finally {
      this.pinging = false;
    }
  }

  // --- Reconnect with backoff ------------------------------------------------

  /**
   * Ordered, deduped list of addresses to try for this target:
   *   1. a live mDNS hit (known reachable on the current LAN right now),
   *   2. stored candidates (LAN-first, then Tailscale) from QR + snapshots,
   *   3. the last-known single address as a final fallback.
   * reconnectToDesktop() tries these in order, so a LAN pairing still
   * reconnects over a VPN when the LAN address is unreachable.
   */
  private resolveCandidates(target: Extract<ConnectionTarget, { type: 'webrtc' }>): string[] {
    const list: string[] = [];
    try {
      const hit = getDiscoveredDesktops().find((d) => d.fingerprint === target.fingerprint && d.address);
      if (hit?.address) list.push(hit.address);
    } catch { /* discovery may be unavailable */ }
    if (target.candidateAddresses) list.push(...target.candidateAddresses);
    if (target.desktopAddress) list.push(target.desktopAddress);
    return [...new Set(list.filter(Boolean))];
  }

  /**
   * Persist the desktop's advertised address list from a snapshot so an
   * existing (LAN-made) pairing auto-upgrades to reach the desktop over a VPN.
   * Also updates the in-memory target so the very next reconnect can use them.
   */
  private absorbDeviceAddresses(snapshot: WorkspaceSnapshot): void {
    const target = this.target;
    if (!target || target.type !== 'webrtc') return;
    const addrs = snapshot.deviceAddresses;
    if (!addrs || addrs.length === 0) return;
    target.candidateAddresses = [...new Set([...(target.candidateAddresses ?? []), ...addrs])];
    mergeCandidateAddresses(
      { pairingId: target.pairingId || undefined, fingerprint: target.fingerprint },
      addrs,
    ).catch(() => { /* best-effort persistence */ });
  }

  // --- Hydration pull --------------------------------------------------------
  // The desktop only PUSHES a snapshot in the first ~3s after connect; over a
  // slow/relayed VPN path or a mobile-network bounce that push can be missed,
  // leaving the UI permanently empty (patches have no base to apply to). So the
  // phone also PULLS: ask for a snapshot on every (re)connect and keep asking
  // until one actually lands (cancelHydration() is called by the snapshot
  // handler). This is what makes hydration resilient to slow VPN convergence
  // and 4G↔5G / VPN-drop bounces.

  private startHydration(): void {
    this.cancelHydration();
    this.resyncAttempts = 0;
    this.sendResyncRequest(); // ask once immediately on (re)connect
    const tick = (): void => {
      this.resyncTimer = null;
      if (this.currentSnapshot) return;       // hydrated — stop
      if (this.resyncAttempts >= 20) return;  // give up quietly after ~30s
      this.resyncAttempts += 1;
      this.sendResyncRequest();
      this.resyncTimer = setTimeout(tick, 1500);
    };
    this.resyncTimer = setTimeout(tick, 1500);
  }

  /** Ask the desktop for a full snapshot (resync-request on the UI channel). */
  private sendResyncRequest(): void {
    try {
      webrtc.send('ui', JSON.stringify({ type: 'resync-request', ts: Date.now() }));
    } catch { /* channel not open yet — a later tick retries */ }
  }

  private cancelHydration(): void {
    if (this.resyncTimer) { clearTimeout(this.resyncTimer); this.resyncTimer = null; }
    this.resyncAttempts = 0;
  }

  private scheduleReconnect(): void {
    if (this.userDisconnected || this.gaveUp) return; // deliberate / given up — stay down
    if (!this.target || this.target.type !== 'webrtc') return;

    // Mark the start of the outage on the first retry of a run, so the give-up
    // ceiling measures *continuous* unreachability (reset to 0 on reconnect).
    if (!this.outageStartedAt) this.outageStartedAt = Date.now();

    // Give up only after a long ceiling — long enough that tunnels, lifts, and
    // wifi↔cellular handoffs never trip it, but a genuinely-gone desktop
    // eventually surfaces a terminal disconnect (which returns the user to the
    // device list). A normal blip recovers far inside this window.
    if (Date.now() - this.outageStartedAt > RECONNECT_GIVEUP_MS) {
      this.gaveUp = true;
      this.cancelReconnect();
      this.reconnecting = false;
      console.log('[Connection] Reconnect ceiling reached — surfacing terminal disconnect');
      this.emitStateChange('disconnected', this.target.fingerprint);
      return;
    }

    if (this.reconnectTimer || this.reconnecting) return;

    // Exponential backoff capped at 15s; keep retrying as long as a target is set.
    const delay = Math.min(2_000 * Math.pow(1.6, this.reconnectAttempts), 15_000);

    this.reconnectTimer = setTimeout(async () => {
      this.reconnectTimer = null;
      const target = this.target;
      if (!target || target.type !== 'webrtc') return;

      this.reconnecting = true;
      this.reconnectAttempts += 1;
      // "Reconnecting…" once we've had a live link; only the very first attempt
      // for a never-connected target reads as plain "Connecting…".
      this.emitStateChange(this.everConnected ? 'reconnecting' : 'connecting', target.fingerprint);

      const candidates = this.resolveCandidates(target);
      try {
        if (candidates.length === 0) throw new Error('No reachable address for desktop');
        await webrtc.reconnectToDesktop(
          candidates,
          target.pairingId,
          target.mobileApiPort,
          target.fingerprint,
          target.sharedSecret,
        );
        // Success path: the 'connected' state handler resets counters, restarts
        // the heartbeat, and cancels any pending reconnect.
        this.reconnecting = false;
      } catch (err) {
        console.log(`[Connection] Reconnect attempt ${this.reconnectAttempts} failed: ${err instanceof Error ? err.message : String(err)}`);
        this.reconnecting = false;
        if (isRepairRequired(err)) {
          // Retrying cannot fix this — the desktop has nothing to check us
          // against. Stop, and let the user see a terminal failure rather than
          // an app that looks like it is still trying.
          this.gaveUp = true;
          this.emitStateChange('failed', target.fingerprint);
          return;
        }
        this.scheduleReconnect(); // try again with longer backoff
      }
    }, delay);
  }

  /**
   * Plan item 5.2 — NetInfo handler. Fires on any network state change
   * (wifi↔cellular, VPN flip, isInternetReachable transition). We
   * coalesce on (type, isInternetReachable) — only meaningful changes
   * trigger a reconnect kick, so a flapping signal doesn't thrash.
   */
  private handleNetInfo(s: NetInfoState): void {
    if (!this.target || this.target.type !== 'webrtc') return;
    const reachable = s.isInternetReachable;
    const meaningful = (
      s.type !== this.lastNetInfoType ||
      reachable !== this.lastNetInfoReachable
    );
    this.lastNetInfoType = s.type;
    this.lastNetInfoReachable = reachable;
    if (!meaningful) return;
    diagLog('netinfo', `transition type=${s.type} reachable=${String(reachable)}`);

    // Only act on transitions back to reachable. Going offline is
    // already handled reactively by the heartbeat; the proactive
    // value here is "we just came back online — try a snappy
    // reconnect now instead of waiting up to 30s for heartbeat
    // timeout."
    if (reachable !== true) return;
    if (webrtc.state === 'connected') {
      // Connection is still alive on this NetInfo report — but the
      // network type changed (wifi↔cellular handoff). Force a probe
      // by zeroing the heartbeat clock so the next tick checks.
      this.lastInboundAt = 0;
      return;
    }
    // Snappy reconnect path — same as AppState foreground.
    this.reconnectAttempts = 0;
    this.scheduleReconnect();
  }

  private handleAppState(s: AppStateStatus): void {
    if (!this.target || this.target.type !== 'webrtc') return;
    diagLog('lifecycle', `AppState → ${s}`);
    if (s === 'active') {
      // Resume: the transport often dies while backgrounded — re-link promptly.
      this.lastInboundAt = 0; // force the next heartbeat to actually probe
      this.startHeartbeat();
      if (webrtc.state !== 'connected' && !this.reconnecting) {
        this.reconnectAttempts = 0; // snappy resume (no long backoff)
        this.scheduleReconnect();
      }
    } else if (s === 'background') {
      // The OS freezes timers when suspended; stop pinging to save battery.
      this.stopHeartbeat();
    }
  }

  private cancelReconnect(): void {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
  }

  private emitStateChange(state: ConnectionState, fingerprint: string): void {
    diagLog('connection', `→ ${state}`, { fp: fingerprint.slice(0, 12) });
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
