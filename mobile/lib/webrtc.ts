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

import type { ConnectionState, PairingQrPayload, PairingAnswer } from './types';
import { createHash } from './crypto';

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
   * Create a WebRTC answer from a desktop's QR payload.
   * This is the mobile side of the pairing handshake.
   *
   * @returns The answer payload to send back to the desktop,
   *          plus the 6-digit confirmation code to display.
   */
  async createAnswerFromOffer(payload: PairingQrPayload): Promise<PairingAnswer> {
    this.cleanup();

    const { RTCPeerConnection, RTCSessionDescription, RTCIceCandidate } = getWebRTC();
    const pc = new RTCPeerConnection({ iceServers: STUN_SERVERS });
    this.pc = pc;

    // Set the desktop's offer as remote description
    await pc.setRemoteDescription(
      new RTCSessionDescription({ type: 'offer', sdp: payload.offer }),
    );

    // Add the desktop's ICE candidates
    for (const candidateStr of payload.ice) {
      try {
        const candidate = JSON.parse(candidateStr);
        await pc.addIceCandidate(new RTCIceCandidate(candidate));
      } catch {
        // Skip malformed candidates
      }
    }

    // Create our answer
    const answer = await pc.createAnswer();
    await pc.setLocalDescription(answer);

    // Gather our ICE candidates
    const iceCandidates = await this.gatherIceCandidates(pc);

    // Extract our fingerprint from the SDP
    const fingerprint = this.extractFingerprint(answer.sdp ?? '');

    // Derive the 6-digit confirmation code
    const code = await deriveConfirmationCode(fingerprint, payload.nonce);

    return {
      nonce: payload.nonce,
      answer: answer.sdp ?? '',
      ice: iceCandidates,
      fp: fingerprint,
      code,
    };
  }

  /**
   * Complete the connection after pairing is confirmed.
   * Sets up data channel listeners and starts heartbeat.
   */
  async connect(): Promise<void> {
    if (!this.pc) throw new Error('No peer connection — call createAnswerFromOffer first');

    this.setState('connecting');

    // Listen for data channels created by the desktop (initiator)
    this.pc.ondatachannel = (event: { channel: any }) => {
      const channel = event.channel;
      this.setupChannel(channel);
    };

    // Monitor connection state
    this.pc.onconnectionstatechange = () => {
      const state = this.pc?.connectionState;
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

    // Also create our own data channels (in case we're the initiator)
    for (const name of Object.values(DATA_CHANNELS)) {
      if (!this.channels.has(name)) {
        const channel = this.pc.createDataChannel(name, { ordered: true });
        this.setupChannel(channel);
      }
    }
  }

  /**
   * Reconnect to a previously paired desktop using the stored
   * offer/answer negotiation. (Simplified: re-creates the connection.)
   */
  async reconnect(offerSdp: string, iceCandidates: string[]): Promise<string> {
    this.cleanup();

    const { RTCPeerConnection, RTCSessionDescription, RTCIceCandidate } = getWebRTC();
    const pc = new RTCPeerConnection({ iceServers: STUN_SERVERS });
    this.pc = pc;
    this.setState('reconnecting');

    await pc.setRemoteDescription(
      new RTCSessionDescription({ type: 'offer', sdp: offerSdp }),
    );

    for (const candidateStr of iceCandidates) {
      try {
        await pc.addIceCandidate(new RTCIceCandidate(JSON.parse(candidateStr)));
      } catch { /* skip */ }
    }

    const answer = await pc.createAnswer();
    await pc.setLocalDescription(answer);

    // Set up channels and monitoring
    await this.connect();

    return answer.sdp ?? '';
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

  private extractFingerprint(sdp: string): string {
    const match = sdp.match(/a=fingerprint:sha-256\s+([0-9A-Fa-f:]+)/);
    if (match) return match[1];
    // Fallback: generate a random fingerprint
    return Array.from({ length: 32 }, () =>
      Math.floor(Math.random() * 256).toString(16).padStart(2, '0'),
    ).join(':').toUpperCase();
  }
}

// --- Helpers -----------------------------------------------------------------

/**
 * Derive a 6-digit confirmation code from fingerprint + nonce.
 * Must match the desktop's `deriveConfirmationCode()`.
 */
async function deriveConfirmationCode(fingerprint: string, nonce: string): Promise<string> {
  const hash = await createHash(`${fingerprint}:${nonce}`);
  const num = parseInt(hash.slice(0, 8), 16) % 1_000_000;
  return num.toString().padStart(6, '0');
}

/** Singleton instance. */
export const webrtc = new WebRTCManager();
