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
  /** Desktop's LAN address. */
  desktopAddress: string;
}

// --- WebRTC Manager ----------------------------------------------------------

export class WebRTCManager {
  private pc: any = null; // RTCPeerConnection (typed as any for lazy-load compat)
  private channels = new Map<string, any>(); // RTCDataChannel
  private messageHandlers = new Set<MessageHandler>();
  private stateHandlers = new Set<StateHandler>();
  private _state: ConnectionState = 'disconnected';

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
    const baseUrl = `http://${qrPayload.h}:${qrPayload.p}`;

    console.log(`[WebRTC] Fetching offer from ${baseUrl}/offer`);
    const offerRes = await fetch(`${baseUrl}/offer?c=${encodeURIComponent(qrPayload.c)}`);
    if (!offerRes.ok) {
      const body = await offerRes.json().catch(() => ({ error: 'Request failed' }));
      throw new Error(`Failed to fetch offer: ${body.error || offerRes.status}`);
    }
    const offerData: PairingOfferResponse = await offerRes.json();

    console.log(
      `[WebRTC] Got offer — fp=${offerData.fingerprint.slice(0, 16)}… ` +
      `nonce=${offerData.nonce.slice(0, 8)}…`,
    );

    return { offerData, baseUrl };
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

    const { RTCPeerConnection, RTCSessionDescription } = webrtcMod;

    // 2. Create peer connection and set remote description
    const pc = new RTCPeerConnection({ iceServers: STUN_SERVERS });
    this.pc = pc;

    await pc.setRemoteDescription(
      new RTCSessionDescription({ type: 'offer', sdp: offerData.offer }),
    );

    // 3. Create answer
    const answer = await pc.createAnswer();
    await pc.setLocalDescription(answer);

    console.log('[WebRTC] Answer created, gathering ICE candidates…');

    // 4. Gather ICE candidates
    const iceCandidates = await this.gatherIceCandidates(pc);
    console.log(`[WebRTC] Gathered ${iceCandidates.length} ICE candidates`);

    // 5. Extract our fingerprint from answer SDP
    const answerSdp = answer.sdp ?? '';
    const fpMatch = answerSdp.match(/a=fingerprint:sha-256\s+([0-9A-Fa-f:]+)/);
    const ourFingerprint = fpMatch?.[1] ?? '';

    if (!ourFingerprint) {
      throw new Error('Failed to extract our fingerprint from answer SDP');
    }

    // 6. Post our answer back to the temp server
    console.log(`[WebRTC] Posting answer to ${baseUrl}/answer`);
    const answerRes = await fetch(`${baseUrl}/answer`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        c: qrPayload.c,
        answer: answerSdp,
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
      `[WebRTC] Answer accepted — confirmCode=${answerResult.confirmCode}`,
    );

    // 7. Set up connection monitoring
    this.setupConnectionMonitoring(pc);

    return {
      confirmCode: answerResult.confirmCode,
      desktopFingerprint: ensureColonFingerprint(offerData.fingerprint),
      desktopAddress: qrPayload.h,
    };
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
