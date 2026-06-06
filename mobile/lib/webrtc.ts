/**
 * WebRTC wrapper — manages the peer connection and data channels
 * for communication with a paired desktop.
 *
 * Uses `react-native-webrtc` which provides the standard WebRTC API
 * (RTCPeerConnection, RTCSessionDescription, etc.) on React Native.
 *
 * Data channels match the desktop's wire protocol:
 *   - `control` — JSON-RPC commands, agent sessions, channel events
 *   - `ui`      — state snapshots + JSON patches
 *   - `terminal` — binary PTY I/O
 *   - `audio`   — WebM/Opus chunks
 */

import type {
  ConnectionState,
  PairingQrPayload,
  PairingOfferResponse,
  PairingAnswerResponse,
} from './types';
import {
  ensureColonFingerprint,
} from './sdp-minimal';

// Lazy-load react-native-webrtc to avoid crashing Expo Go (which
// doesn't have native WebRTC linked). The import only fires when
// the user actually initiates pairing or connection.
let _webrtcModule: typeof import('react-native-webrtc') | null = null;
function getWebRTC() {
  if (!_webrtcModule) {
    try {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      _webrtcModule = require('react-native-webrtc');
    } catch (err) {
      throw new Error(
        'react-native-webrtc is not available. ' +
        'WebRTC requires a development build (not Expo Go). ' +
        'Run `npx expo run:ios` or `npx expo run:android` instead.\n' +
        String(err),
      );
    }
  }
  return _webrtcModule;
}

// --- Constants ---------------------------------------------------------------

const STUN_SERVERS = [
  { urls: 'stun:stun.l.google.com:19302' },
  { urls: 'stun:stun1.l.google.com:19302' },
];

const DATA_CHANNELS = {
  CONTROL: 'control',
  UI: 'ui',
  TERMINAL: 'terminal',
  AUDIO: 'audio',
} as const;

type DataChannelName = (typeof DATA_CHANNELS)[keyof typeof DATA_CHANNELS];

// --- Types -------------------------------------------------------------------

type MessageHandler = (channel: DataChannelName, data: string | ArrayBuffer) => void;
type StateHandler = (state: ConnectionState) => void;

/** Result of the v4 pairing handshake. */
export interface PairingResult {
  /** Bluetooth-style confirmation code (same on both devices). */
  confirmCode: string;
  /** Desktop's DTLS fingerprint. */
  desktopFingerprint: string;
  /** The address that actually answered during pairing (LAN or VPN). */
  desktopAddress: string;
  /**
   * All addresses the desktop advertised in the QR (LAN + Tailscale/VPN),
   * winner first. Stored so reconnect can try each — a LAN pairing then works
   * over a VPN without re-pairing.
   */
  candidateAddresses: string[];
  /** Stable pairing identity — survives restarts on both sides. */
  pairingId: string;
}

// --- WebRTC Manager ----------------------------------------------------------

export class WebRTCManager {
  private pc: any = null; // RTCPeerConnection (typed as any for lazy-load compat)
  private channels = new Map<string, any>(); // RTCDataChannel
  private messageHandlers = new Set<MessageHandler>();
  private stateHandlers = new Set<StateHandler>();
  private _state: ConnectionState = 'disconnected';
  /** Set by disconnect() to abort an in-flight multi-candidate reconnect sweep. */
  private reconnectCanceled = false;

  get state(): ConnectionState {
    return this._state;
  }

  /**
   * v4 pairing — fetch the full SDP offer from the desktop's temp server,
   * create a WebRTC answer, and post it back. Much simpler than v3 since
   * no SDP reconstruction is needed.
   *
   * Flow:
   *   1. `GET /offer?c=<code>` from temp server → full SDP + ICE + nonce.
   *   2. Create RTCPeerConnection, set remote description (full SDP).
   *   3. Create answer, set local description.
   *   4. Gather ICE candidates.
   *   5. `POST /answer` with our answer SDP + ICE + fingerprint + nonce.
   *   6. Receive Bluetooth-style confirmation code from server.
   *   7. Set up connection monitoring.
   *   8. Return the confirmation code for display.
   */
  /**
   * Fetch the desktop's offer from the temp pairing server.
   * This is a pure HTTP call — works in Expo Go, no native modules needed.
   * Useful for verifying the QR → HTTP pipeline independently of WebRTC.
   */
  async fetchOffer(qrPayload: PairingQrPayload): Promise<{
    offerData: PairingOfferResponse;
    baseUrl: string;
  }> {
    // Try every address the desktop advertised (LAN + Tailscale/VPN) and use
    // whichever answers first — so a QR works on the same network OR over a VPN
    // without the phone knowing which it's on. Falls back to the single `h`.
    const hosts = qrPayload.hs && qrPayload.hs.length ? qrPayload.hs : [qrPayload.h];
    console.log(`[WebRTC] Fetching offer — racing ${hosts.length} host(s): ${hosts.join(', ')}`);

    const tryHost = async (host: string) => {
      const baseUrl = `http://${host}:${qrPayload.p}`;
      const res = await fetch(`${baseUrl}/offer?c=${encodeURIComponent(qrPayload.c)}`);
      if (!res.ok) {
        const body = await res.json().catch(() => ({ error: 'Request failed' }));
        throw new Error(`offer ${host}: ${body.error || res.status}`);
      }
      return { offerData: (await res.json()) as PairingOfferResponse, baseUrl };
    };

    let winner: { offerData: PairingOfferResponse; baseUrl: string };
    try {
      winner = await Promise.any(hosts.map(tryHost));
    } catch {
      throw new Error(
        `Couldn't reach your desktop on any address (${hosts.join(', ')}). ` +
        `Make sure you're on the same Wi-Fi or your VPN (e.g. Tailscale) is connected.`,
      );
    }

    console.log(
      `[WebRTC] Got offer via ${winner.baseUrl} — fp=${winner.offerData.fingerprint.slice(0, 16)}…`,
    );
    return winner;
  }

  /**
   * Check whether the WebRTC native module is available.
   * Returns false in Expo Go (no native module), true in dev builds.
   */
  isWebRTCAvailable(): boolean {
    try {
      getWebRTC();
      return true;
    } catch {
      return false;
    }
  }

  async pairWithDesktop(qrPayload: PairingQrPayload): Promise<PairingResult> {
    this.cleanup();

    // Phase 1: HTTP exchange — works everywhere (including Expo Go)
    const { offerData, baseUrl } = await this.fetchOffer(qrPayload);

    // Phase 2: WebRTC — requires native module (dev build only)
    let webrtcMod: ReturnType<typeof getWebRTC>;
    try {
      webrtcMod = getWebRTC();
    } catch {
      throw new Error(
        'Offer fetched successfully from desktop, but WebRTC is not available.\n\n' +
        'WebRTC requires a development build (not Expo Go).\n' +
        'Run: npx expo run:ios  or  npx expo run:android',
      );
    }

    const { RTCPeerConnection, RTCSessionDescription, RTCIceCandidate } = webrtcMod!;

    // 2. Create peer connection
    const pc = new RTCPeerConnection({ iceServers: STUN_SERVERS });
    this.pc = pc;

    // Set up connection monitoring BEFORE setting remote description,
    // so ondatachannel events from the desktop aren't missed.
    this.setupConnectionMonitoring(pc);

    await pc.setRemoteDescription(
      new RTCSessionDescription({ type: 'offer', sdp: offerData.offer }),
    );

    // Add remote ICE candidates from the offer (if not already inlined in SDP)
    if (offerData.ice && Array.isArray(offerData.ice)) {
      console.log(`[WebRTC] Adding ${offerData.ice.length} remote ICE candidates from offer`);
      for (const candidateJson of offerData.ice) {
        try {
          const candidate = typeof candidateJson === 'string'
            ? JSON.parse(candidateJson)
            : candidateJson;
          if (candidate.candidate && RTCIceCandidate) {
            await pc.addIceCandidate(new RTCIceCandidate(candidate));
          }
        } catch (err) {
          console.warn('[WebRTC] Failed to add remote ICE candidate:', err);
        }
      }
    }

    // 3. Create answer
    const answer = await pc.createAnswer();
    await pc.setLocalDescription(answer);

    console.log('[WebRTC] Answer created, gathering ICE candidates…');

    // 4. Gather ICE candidates
    const iceCandidates = await this.gatherIceCandidates(pc);
    console.log(`[WebRTC] Gathered ${iceCandidates.length} ICE candidates`);

    // 5. Extract our fingerprint from the final local description SDP
    // (includes gathered ICE candidates inlined)
    const finalSdp = pc.localDescription?.sdp ?? answer.sdp ?? '';
    const fpMatch = finalSdp.match(/a=fingerprint:sha-256\s+([0-9A-Fa-f:]+)/);
    const ourFingerprint = fpMatch?.[1] ?? '';

    if (!ourFingerprint) {
      throw new Error('Failed to extract our fingerprint from answer SDP');
    }

    // 6. Post our answer back to the temp server
    console.log(`[WebRTC] Posting answer to ${baseUrl}/answer (SDP length=${finalSdp.length})`);
    const answerRes = await fetch(`${baseUrl}/answer`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        c: qrPayload.c,
        answer: finalSdp,
        ice: iceCandidates,
        fingerprint: ourFingerprint,
        nonce: offerData.nonce,
      }),
    });

    if (!answerRes.ok) {
      const body = await answerRes.json().catch(() => ({ error: 'Request failed' }));
      throw new Error(`Failed to submit answer: ${body.error || answerRes.status}`);
    }

    const answerResult: PairingAnswerResponse = await answerRes.json();

    console.log(
      `[WebRTC] Answer accepted — confirmCode=${answerResult.confirmCode} pairingId=${answerResult.pairingId?.slice(0, 8)}…`,
    );

    // The host that actually answered (parsed from the winning baseUrl).
    const winningHost = baseUrl.replace(/^https?:\/\//, '').split(':')[0] || qrPayload.h;
    // All advertised addresses, winner first so reconnect tries the working
    // one before the rest (LAN pairing → still reconnects over a VPN later).
    const advertised = qrPayload.hs && qrPayload.hs.length ? qrPayload.hs : [qrPayload.h];
    const candidateAddresses = [...new Set([winningHost, ...advertised])].filter(Boolean);

    return {
      confirmCode: answerResult.confirmCode,
      desktopFingerprint: ensureColonFingerprint(offerData.fingerprint),
      desktopAddress: winningHost,
      candidateAddresses,
      pairingId: answerResult.pairingId,
    };
  }

  /**
   * Reconnect to a previously paired desktop using its known address.
   * The desktop's Express server (port 3001) has a reconnection
   * endpoint that creates a fresh WebRTC offer for paired devices.
   *
   * Auth is via `pairingId` — a stable UUID agreed during initial pairing
   * that survives app restarts and fingerprint changes.
   *
   * Flow:
   *   1. POST /api/mobile/reconnect with pairingId → get offer SDP.
   *   2. Create RTCPeerConnection, set remote description (offer).
   *   3. Create answer, gather ICE candidates.
   *   4. POST /api/mobile/reconnect/answer with pairingId + answer SDP.
   *   5. Desktop sets up data channels + heartbeat.
   *   6. WebRTC connects → state changes to 'connected'.
   */
  /**
   * Result from a reconnection attempt. Includes pairingId so
   * pre-upgrade clients can store it for future use.
   */
  lastReconnectPairingId: string | null = null;
  /** Address that produced the last successful reconnect (for sticky reuse). */
  lastReconnectAddress: string | null = null;

  /**
   * Reconnect to a previously paired desktop. Accepts a single address or a
   * list of candidate addresses (LAN + Tailscale/VPN). Candidates are tried in
   * order — failing fast on unreachable ones — and the first that returns a
   * valid offer wins. This is what lets a pairing made on the LAN reconnect
   * later over a VPN without re-pairing.
   *
   * Candidates are tried SEQUENTIALLY, never raced: the desktop keeps a single
   * pending-offer peer connection per machine, so two concurrent reconnect
   * requests to the same desktop (two of its IPs) would clobber each other's
   * DTLS offer and fail the handshake.
   */
  async reconnectToDesktop(
    desktopAddress: string | string[],
    pairingId: string,
    mobileApiPort: number = 19480,
    fingerprint?: string,
  ): Promise<void> {
    this.cleanup();
    this.lastReconnectPairingId = null;
    this.lastReconnectAddress = null;
    this.reconnectCanceled = false;

    const candidates = [
      ...new Set(
        (Array.isArray(desktopAddress) ? desktopAddress : [desktopAddress])
          .map((a) => (a || '').trim())
          .filter(Boolean),
      ),
    ];
    if (candidates.length === 0) {
      this.setState('failed');
      throw new Error('No desktop address to reconnect to');
    }

    this.setState('connecting');

    const errors: string[] = [];
    for (const address of candidates) {
      if (this.reconnectCanceled) break; // user hit Cancel / Disconnect
      try {
        await this.attemptReconnect(address, pairingId, mobileApiPort, fingerprint);
        if (this.reconnectCanceled) { this.cleanup(); break; }
        this.lastReconnectAddress = address;
        return; // success — the 'connected' state handler takes over from here
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        errors.push(`${address}: ${msg}`);
        console.log(`[WebRTC] Reconnect candidate ${address} failed: ${msg}`);
        this.cleanup(); // tear down the half-open PC before trying the next one
      }
    }

    // Canceled mid-sweep: disconnect() already set 'disconnected' — don't flip
    // to 'failed' (which would re-arm the connection manager's auto-reconnect).
    if (this.reconnectCanceled) return;

    this.setState('failed');
    throw new Error(
      `Reconnect failed — tried ${candidates.length} address(es): ${errors.join(' | ')}`,
    );
  }

  /**
   * A single reconnect attempt against one address. Throws on any failure so
   * the multi-candidate driver can move on; it deliberately does NOT set the
   * 'failed' state — only the driver does that, once every candidate has failed.
   */
  private async attemptReconnect(
    desktopAddress: string,
    pairingId: string,
    mobileApiPort: number,
    fingerprint?: string,
  ): Promise<void> {
    const baseUrl = `http://${desktopAddress}:${mobileApiPort}`;

    console.log(`[WebRTC] Requesting reconnect offer from ${baseUrl} (pairingId=${pairingId?.slice(0, 8) ?? 'none'}, fp=${fingerprint?.slice(0, 12) ?? 'none'})`);

    // 1. Request a reconnection offer — send pairingId (preferred) + fingerprint
    //    (fallback). Bounded by an AbortController so an unreachable address
    //    fails in a few seconds instead of hanging on the OS TCP timeout (which
    //    would stall the whole candidate sweep).
    const offerRes = await (async () => {
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), 6000);
      try {
        return await fetch(`${baseUrl}/api/mobile/reconnect`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ pairingId: pairingId || undefined, fingerprint: fingerprint || undefined }),
          signal: ctrl.signal,
        });
      } finally {
        clearTimeout(timer);
      }
    })();

    if (!offerRes.ok) {
      const body = await offerRes.json().catch(() => ({ error: 'Request failed' }));
      throw new Error(`offer rejected: ${body.error || offerRes.status}`);
    }

    const offerData = await offerRes.json();
    console.log(`[WebRTC] Got reconnect offer — desktop fp=${offerData.fingerprint?.slice(0, 16)}… pairingId=${offerData.pairingId?.slice(0, 8) ?? 'none'}`);

    // Store the pairingId returned by the desktop (enables silent upgrade
    // for pre-pairingId clients — the connection manager reads this after connect)
    if (offerData.pairingId) {
      this.lastReconnectPairingId = offerData.pairingId;
    }

    // 2. Create peer connection and set remote description
    let webrtcMod: ReturnType<typeof getWebRTC>;
    try {
      webrtcMod = getWebRTC();
    } catch {
      throw new Error('WebRTC native module not available');
    }

    const { RTCPeerConnection, RTCSessionDescription, RTCIceCandidate } = webrtcMod!;

    const pc = new RTCPeerConnection({ iceServers: STUN_SERVERS });
    this.pc = pc;

    // Set up connection monitoring BEFORE setting remote description,
    // so ondatachannel events from the desktop aren't missed.
    this.setupConnectionMonitoring(pc);

    await pc.setRemoteDescription(
      new RTCSessionDescription({ type: 'offer', sdp: offerData.offer }),
    );

    // Add remote ICE candidates from the offer response (if not inlined in SDP)
    if (offerData.ice && Array.isArray(offerData.ice)) {
      console.log(`[WebRTC] Adding ${offerData.ice.length} remote ICE candidates from offer`);
      for (const candidateJson of offerData.ice) {
        try {
          const candidate = typeof candidateJson === 'string'
            ? JSON.parse(candidateJson)
            : candidateJson;
          if (candidate.candidate && RTCIceCandidate) {
            await pc.addIceCandidate(new RTCIceCandidate(candidate));
          }
        } catch (err) {
          console.warn('[WebRTC] Failed to add remote ICE candidate:', err);
        }
      }
    }

    // 3. Create answer + gather ICE
    const answer = await pc.createAnswer();
    await pc.setLocalDescription(answer);

    console.log('[WebRTC] Reconnect answer created, gathering ICE…');
    const iceCandidates = await this.gatherIceCandidates(pc);

    // Use the final local description SDP (includes gathered ICE candidates
    // inlined) rather than the original answer.sdp (which has none).
    const finalSdp = pc.localDescription?.sdp ?? answer.sdp ?? '';
    const fpMatch = finalSdp.match(/a=fingerprint:sha-256\s+([0-9A-Fa-f:]+)/);
    const actualFingerprint = fpMatch?.[1] ?? '';

    console.log(`[WebRTC] Reconnect answer: ${iceCandidates.length} ICE candidates gathered, SDP length=${finalSdp.length}`);

    // 4. Post answer back to desktop with pairingId for lookup
    console.log(`[WebRTC] Posting reconnect answer to ${baseUrl}`);
    const answerRes = await fetch(`${baseUrl}/api/mobile/reconnect/answer`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        pairingId,
        fingerprint: actualFingerprint,
        answer: finalSdp,
        ice: iceCandidates,
      }),
    });

    if (!answerRes.ok) {
      const body = await answerRes.json().catch(() => ({ error: 'Answer rejected' }));
      throw new Error(`answer rejected: ${body.error || answerRes.status}`);
    }

    console.log('[WebRTC] Reconnect answer accepted — waiting for WebRTC connection');
  }

  /**
   * Send data on a named channel.
   */
  send(channelName: DataChannelName, data: string | ArrayBuffer): boolean {
    const channel = this.channels.get(channelName);
    if (!channel || channel.readyState !== 'open') return false;

    try {
      channel.send(data);
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Send a JSON message on the control channel.
   */
  sendControl(message: Record<string, unknown>): boolean {
    return this.send(DATA_CHANNELS.CONTROL, JSON.stringify(message));
  }

  /**
   * Register a handler for incoming data channel messages.
   */
  onMessage(handler: MessageHandler): () => void {
    this.messageHandlers.add(handler);
    return () => { this.messageHandlers.delete(handler); };
  }

  /**
   * Register a handler for connection state changes.
   */
  onStateChange(handler: StateHandler): () => void {
    this.stateHandlers.add(handler);
    return () => { this.stateHandlers.delete(handler); };
  }

  /**
   * Close the connection and clean up.
   */
  disconnect(): void {
    this.reconnectCanceled = true; // abort any in-flight reconnect sweep
    this.cleanup();
    this.setState('disconnected');
  }

  // --- Internals -------------------------------------------------------------

  /**
   * Set up connection monitoring — data channel listeners and
   * connection state tracking.
   *
   * As the answerer, we do NOT create data channels — we only
   * listen for the ones the desktop (offerer) creates.
   */
  private setupConnectionMonitoring(pc: any): void {
    this.setState('connecting');

    pc.ondatachannel = (event: { channel: any }) => {
      this.setupChannel(event.channel);
    };

    pc.onconnectionstatechange = () => {
      const state = pc.connectionState;
      switch (state) {
        case 'connected':
          this.setState('connected');
          break;
        case 'disconnected':
        case 'closed':
          this.setState('disconnected');
          break;
        case 'failed':
          this.setState('failed');
          break;
      }
    };

    // Also monitor ICE connection state (fires earlier than connectionState)
    pc.oniceconnectionstatechange = () => {
      const iceState = pc.iceConnectionState;
      console.log(`[WebRTC] ICE state: ${iceState}`);
      if (iceState === 'connected' || iceState === 'completed') {
        this.setState('connected');
      } else if (iceState === 'failed') {
        this.setState('failed');
      }
    };
  }

  private setupChannel(channel: any): void {
    const name = channel.label as DataChannelName;
    this.channels.set(name, channel);

    channel.onopen = () => {
      console.log(`[WebRTC] Channel ${name} opened`);
      // When the ui channel opens, request a full state snapshot from desktop.
      // This is more reliable than depending on the desktop's automatic send
      // (which may fire before channels are open due to WebRTC timing).
      if (name === 'ui') {
        console.log('[WebRTC] Requesting resync from desktop…');
        try {
          channel.send(JSON.stringify({
            type: 'resync-request',
            ts: Date.now(),
            sourceInstanceId: 'mobile',
          }));
        } catch (err) {
          console.warn('[WebRTC] Failed to send resync-request:', err);
        }
      }
    };

    channel.onmessage = (event: { data: string | ArrayBuffer }) => {
      for (const handler of this.messageHandlers) {
        try {
          handler(name, event.data);
        } catch {
          // Handler error
        }
      }
    };

    channel.onclose = () => {
      console.log(`[WebRTC] Channel ${name} closed`);
      this.channels.delete(name);
    };
  }

  private setState(state: ConnectionState): void {
    if (this._state === state) return;
    this._state = state;
    for (const handler of this.stateHandlers) {
      try { handler(state); } catch { /* */ }
    }
  }

  private cleanup(): void {
    for (const channel of this.channels.values()) {
      try { channel.close(); } catch { /* */ }
    }
    this.channels.clear();

    if (this.pc) {
      try { this.pc.close(); } catch { /* */ }
      this.pc = null;
    }
  }

  private async gatherIceCandidates(pc: any): Promise<string[]> {
    const candidates: string[] = [];

    return new Promise<string[]>((resolve) => {
      const timeout = setTimeout(() => resolve(candidates), 10_000);

      pc.onicecandidate = (event: { candidate: any | null }) => {
        if (event.candidate) {
          candidates.push(JSON.stringify(event.candidate));
        } else {
          // null candidate means gathering is complete
          clearTimeout(timeout);
          resolve(candidates);
        }
      };
    });
  }
}

/** Singleton instance. */
export const webrtc = new WebRTCManager();
