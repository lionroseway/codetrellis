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

import { extractSingleFingerprint, fingerprintsEqual } from './sdp-fingerprint';
import { computeChallengeMac, deriveConfirmationCode, isUsableSecret } from './peer-auth';

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
  /**
   * Resolves with the reconnect secret once the desktop hands it over, or with
   * `''` if it never does.
   *
   * A promise rather than a value because the two devices are waiting on each
   * other: the desktop sends the secret when the USER confirms, and the user
   * cannot confirm until this screen has shown them the code. Returning the
   * secret directly would deadlock the pairing it is part of.
   *
   * It arrives over the DTLS `control` channel, never through the pairing HTTP
   * server — that server is plaintext on the LAN, so a secret sent through it
   * is a secret any eavesdropper also holds (Phase 19, finding 1.2).
   */
  awaitSecret: () => Promise<string>;
}

/**
 * A pairing that predates Phase 19 and cannot be repaired by retrying.
 *
 * Distinguished from ordinary connection failures so the connection manager
 * stops instead of backing off forever against a desktop that will refuse it
 * every time.
 */
export function repairRequired(): Error {
  const err = new Error(
    'This desktop was paired before reconnect authentication existed. Pair it again from Settings → Devices.',
  );
  err.name = 'RepairRequired';
  return err;
}

export function isRepairRequired(err: unknown): boolean {
  return err instanceof Error && err.name === 'RepairRequired';
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
  /** True once any data channel has actually opened — "we can talk now". We only
   *  surface `connected` after this, NOT on bare ICE connectivity (which fires
   *  several seconds early on slow/VPN links and produces a connected→
   *  disconnected→connected flicker). */
  private channelOpen = false;

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

    // POST, not GET: the code used to travel as `?c=123456`, and a query
    // string is the worst place to keep a short-lived secret — access logs,
    // proxy records, browser history, `Referer` (Phase 19, finding 18).
    //
    // The desktop serves the offer EXACTLY ONCE, so all but one of these
    // races is refused with a 409. That is expected — `Promise.any` below
    // takes whichever succeeded.
    const tryHost = async (host: string) => {
      const baseUrl = `http://${host}:${qrPayload.p}`;
      const res = await fetch(`${baseUrl}/offer`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ c: qrPayload.c }),
      });
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

    // ── PIN THE DESKTOP BEFORE TALKING TO IT ────────────────────────────
    //
    // `offerData.fingerprint` is a field the server chose to send. The value
    // that matters is the one inside the SDP, because that is what the DTLS
    // handshake is verified against — and it is read structurally so the SDP
    // cannot commit to two things at once (Phase 19, finding 2).
    //
    // A disagreement between the two is refused rather than resolved: no
    // honest desktop produces one.
    let desktopFingerprint: string;
    try {
      desktopFingerprint = extractSingleFingerprint(String(offerData.offer ?? ''));
    } catch (err) {
      throw new Error(
        `The desktop's pairing offer is malformed (${(err as Error).message}). ` +
        'Cancel pairing on the desktop and try again.',
      );
    }
    if (offerData.fingerprint && !fingerprintsEqual(desktopFingerprint, offerData.fingerprint)) {
      throw new Error(
        'The desktop announced one certificate and offered another. Pairing refused.',
      );
    }

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
    // (includes gathered ICE candidates inlined). Structural, like everywhere
    // else — if our own answer somehow carried two, the desktop would refuse
    // it anyway and a regex would hide which one we meant.
    const finalSdp = pc.localDescription?.sdp ?? answer.sdp ?? '';
    let ourFingerprint: string;
    try {
      ourFingerprint = extractSingleFingerprint(finalSdp);
    } catch (err) {
      throw new Error(`Failed to read our own fingerprint from the answer SDP: ${(err as Error).message}`);
    }

    // 5b. Derive the confirmation code OURSELVES (Phase 19, finding 1.2).
    //
    // It used to arrive in the desktop's reply and we showed whatever we were
    // given. So the user compared the desktop's number against the desktop's
    // number — a relay terminating both legs supplies both screens, and the
    // check confirmed nothing. Derived from the certificate we actually saw
    // and our own, a relay makes the two screens disagree.
    const confirmCode = deriveConfirmationCode(
      String(offerData.nonce ?? ''),
      desktopFingerprint,
      ourFingerprint,
    );

    // 5c. Start listening for the pairing secret before we post the answer.
    //
    // The desktop sends it over the `control` channel the moment the user
    // confirms, and that can land before this function's HTTP round-trip
    // finishes. Subscribing afterwards would be a race we would lose
    // intermittently and debug as "sometimes reconnect doesn't work".
    const secretPromise = this.awaitPairingSecret();

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

    console.log(`[WebRTC] Answer accepted — pairingId=${answerResult.pairingId?.slice(0, 8)}…`);


    // The host that actually answered (parsed from the winning baseUrl).
    const winningHost = baseUrl.replace(/^https?:\/\//, '').split(':')[0] || qrPayload.h;
    // All advertised addresses, winner first so reconnect tries the working
    // one before the rest (LAN pairing → still reconnects over a VPN later).
    const advertised = qrPayload.hs && qrPayload.hs.length ? qrPayload.hs : [qrPayload.h];
    const candidateAddresses = [...new Set([winningHost, ...advertised])].filter(Boolean);

    return {
      confirmCode,
      // The certificate we actually saw, not the field the server sent.
      desktopFingerprint: ensureColonFingerprint(desktopFingerprint),
      desktopAddress: winningHost,
      candidateAddresses,
      pairingId: answerResult.pairingId,
      // Already in flight — see `secretPromise` above. Subscribing after the
      // HTTP round-trip would be a race we would lose intermittently and then
      // debug as "sometimes reconnect doesn't work".
      awaitSecret: () => secretPromise,
    };
  }

  /**
   * Wait for the desktop to hand over the pairing secret on the `control`
   * channel.
   *
   * Resolves to `''` if it never arrives — the caller decides what that means.
   * It is not an exception because the common cause is the user simply not
   * confirming on the desktop, which is a normal thing to do.
   */
  private awaitPairingSecret(timeoutMs = 120_000): Promise<string> {
    return new Promise<string>((resolve) => {
      let done = false;
      const finish = (secret: string) => {
        if (done) return;
        done = true;
        clearTimeout(timer);
        unsubscribe();
        resolve(secret);
      };

      const timer = setTimeout(() => finish(''), timeoutMs);

      const unsubscribe = this.onMessage((channel, data) => {
        if (channel !== DATA_CHANNELS.CONTROL) return;
        try {
          const text = typeof data === 'string' ? data : new TextDecoder().decode(data);
          const msg = JSON.parse(text);
          if (msg?.type === 'pairing.secret' && isUsableSecret(msg.secret)) {
            console.log('[WebRTC] Pairing secret received');
            finish(msg.secret as string);
          }
        } catch {
          // Not our message.
        }
      });
    });
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
    /**
     * The desktop's DTLS fingerprint from pairing. This is now a PIN, not a
     * credential: it used to be sent to the desktop as an alternative way of
     * identifying ourselves, which authenticated nobody. We check the offer
     * against it instead (Phase 19, finding 2, reverse direction).
     */
    fingerprint?: string,
    /** Secret agreed at pairing. Without it the desktop will refuse us. */
    sharedSecret?: string,
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

    // Checked ONCE, before the sweep. A desktop paired before reconnect
    // authentication existed has no secret to prove anything with, and no
    // address will change that — retrying every candidate would just repeat
    // the same message N times and then retry the lot on a backoff forever.
    if (!isUsableSecret(sharedSecret) || !fingerprint) {
      this.setState('failed');
      throw repairRequired();
    }

    this.setState('connecting');

    const errors: string[] = [];
    for (const address of candidates) {
      if (this.reconnectCanceled) break; // user hit Cancel / Disconnect
      try {
        await this.attemptReconnect(address, pairingId, mobileApiPort, fingerprint, sharedSecret);
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
    /** Pinned desktop certificate. Checked once by the caller, so required here. */
    fingerprint: string,
    /** Pairing secret. Checked once by the caller, so required here. */
    sharedSecret: string,
  ): Promise<void> {
    const baseUrl = `http://${desktopAddress}:${mobileApiPort}`;

    console.log(`[WebRTC] Requesting reconnect offer from ${baseUrl} (pairingId=${pairingId?.slice(0, 8) ?? 'none'})`);

    // Every request is bounded by an AbortController so an unreachable address
    // fails in a few seconds instead of hanging on the OS TCP timeout, which
    // would stall the whole candidate sweep.
    const post = async (path: string, body: unknown, timeoutMs = 6000) => {
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), timeoutMs);
      try {
        return await fetch(`${baseUrl}${path}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
          signal: ctrl.signal,
        });
      } finally {
        clearTimeout(timer);
      }
    };

    // 1a. Ask for a challenge and answer it.
    //
    // The request used to be `{pairingId, fingerprint}` and nothing else —
    // both values this device transmits in the clear on every attempt, so
    // knowing either was enough to be handed an offer. We now prove we hold
    // the secret agreed at pairing (finding 1.2).
    const challengeRes = await post('/api/mobile/auth/challenge', { pairingId });
    if (!challengeRes.ok) {
      throw new Error(`challenge rejected: ${challengeRes.status}`);
    }
    const challenge = (await challengeRes.json()) as { nonce: string; expiresAt: number };
    if (!challenge?.nonce || !challenge?.expiresAt) {
      throw new Error('challenge malformed');
    }

    // 1b. Request the reconnection offer, with the proof.
    const offerRes = await post('/api/mobile/reconnect', {
      pairingId,
      nonce: challenge.nonce,
      expiresAt: challenge.expiresAt,
      mac: computeChallengeMac(sharedSecret, pairingId, challenge.nonce, challenge.expiresAt),
    });

    if (!offerRes.ok) {
      const body = await offerRes.json().catch(() => ({ error: 'Request failed' }));
      throw new Error(`offer rejected: ${body.error || offerRes.status}`);
    }

    const offerData = await offerRes.json();
    console.log(`[WebRTC] Got reconnect offer — pairingId=${offerData.pairingId?.slice(0, 8) ?? 'none'}`);

    // ── PIN THE DESKTOP (Phase 19, finding 2, reverse direction) ──────────
    //
    // The desktop checks our certificate against the paired record. Nothing
    // checked THEIRS: whatever answered on the address we dialled got to
    // present an offer, and we completed the handshake with it. Anyone able
    // to occupy that address — a stale DHCP lease, a hostile access point, a
    // VPN exit — became our desktop.
    //
    // Read structurally, not with a regex, for the same reason the desktop
    // does: a first-match read lets a peer prepend the fingerprint we are
    // looking for while handshaking with a different certificate.
    let offeredFingerprint: string;
    try {
      offeredFingerprint = extractSingleFingerprint(String(offerData.offer ?? ''));
    } catch (err) {
      throw new Error(`offer SDP unusable: ${(err as Error).message}`);
    }
    if (!fingerprintsEqual(offeredFingerprint, fingerprint)) {
      throw new Error(
        'the machine answering on this address is not the desktop this device was paired with',
      );
    }

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
    const actualFingerprint = extractSingleFingerprint(finalSdp);

    console.log(`[WebRTC] Reconnect answer: ${iceCandidates.length} ICE candidates gathered, SDP length=${finalSdp.length}`);

    // 4. Post answer back to desktop with pairingId for lookup
    console.log(`[WebRTC] Posting reconnect answer to ${baseUrl}`);
    const answerRes = await post('/api/mobile/reconnect/answer', {
      pairingId,
      fingerprint: actualFingerprint,
      answer: finalSdp,
      ice: iceCandidates,
    }, 10000);

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
          // Only surface `connected` once a data channel is open — ICE/peer
          // connectivity alone isn't usable yet (and flickers on slow links).
          this.markConnectedIfReady();
          break;
        case 'disconnected':
          // Transient per the WebRTC spec — connectivity may self-heal without a
          // full reconnect. (Only ever entered after we were connected.) Surface
          // it as recovering, not a hard disconnect, so a blip never tears down
          // or boots the user.
          this.setState('reconnecting');
          break;
        case 'closed':
          // We closed it — either a deliberate disconnect() (which sets the
          // terminal 'disconnected' itself) or a reconnect teardown (which is
          // about to re-establish). Don't emit a terminal state here, or a
          // reconnect's own cleanup would spuriously boot the user.
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
        this.markConnectedIfReady();
      } else if (iceState === 'disconnected') {
        this.setState('reconnecting');
      } else if (iceState === 'failed') {
        this.setState('failed');
      }
    };
  }

  /** Surface `connected` only when a data channel is open (usable). */
  private markConnectedIfReady(): void {
    if (this.channelOpen) this.setState('connected');
  }

  private setupChannel(channel: any): void {
    const name = channel.label as DataChannelName;
    this.channels.set(name, channel);

    channel.onopen = () => {
      console.log(`[WebRTC] Channel ${name} opened`);
      // A channel is open → the link is now usable. This is the point we call
      // ourselves `connected` (not bare ICE), which removes the early flicker.
      this.channelOpen = true;
      this.setState('connected');
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
    this.channelOpen = false; // channels are about to close → no longer usable
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
