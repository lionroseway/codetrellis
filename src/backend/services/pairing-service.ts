/**
 * Pairing service — Phase 11 v4 of the CDev target architecture.
 *
 * Bluetooth-style pairing flow:
 *
 *   1. Desktop calls `initiatePairing()` → starts a temp HTTP server,
 *      returns QR payload `{v:4, h, p, c}` (~50 bytes).
 *   2. Phone scans QR → fetches full SDP offer from temp server →
 *      creates WebRTC answer → posts answer back to temp server.
 *   3. Desktop receives answer → establishes WebRTC connection.
 *   4. Both sides derive a 6-digit confirmation code from
 *      `hash(nonce + sorted_fingerprints)` and display it.
 *   5. User confirms the codes match → pairing is saved.
 *
 * No SDP in the QR. No webcam scanning of a second QR. No ports
 * exposed beyond the 60-second temp server window.
 */

import type { PairingQrPayload, PairedDevice } from '../../shared/types';
import {
  startPairingServer,
  stopPairingServer,
  
  deriveConfirmationCode,
  type PairingAnswer,
  type PairingServerResult,
} from './pairing-server';
import { upsertPairedDevice, touchPairedDevice } from './paired-device-service';
import { stripColonFingerprint } from '../../shared/lib/sdp-minimal';
import { sendToPeer, onConnectionStateChange } from './webrtc-service';
import { DATA_CHANNELS } from '../../shared/types';
import { DEFAULT_GRANTS } from './peer-capabilities';

// --- Active pairing state ----------------------------------------------------

interface ActivePairing {
  /** Server result (code, address, port, nonce). */
  server: PairingServerResult;
  /** Desktop's DTLS fingerprint. */
  desktopFingerprint: string;
  /** Full offer SDP (for WebRTC completion). */
  offerSdp: string;
  /** Received answer (set when phone posts back). */
  answer: PairingAnswer | null;
  /** Confirmation code (set after answer received). */
  confirmCode: string | null;
  /**
   * Secret for authenticating later reconnects.
   *
   * Handed to the phone over the DTLS `control` channel at confirm time, not
   * through the pairing server — see `peer-auth.ts` for why.
   */
  sharedSecret: string;
}

let activePairing: ActivePairing | null = null;

// --- Public API --------------------------------------------------------------

/**
 * Initiate a v4 pairing session. Opens a temp HTTP server and
 * returns the QR payload + a promise for the phone's answer.
 *
 * Only one pairing session can be active at a time.
 *
 * @param offerSdp       Full WebRTC SDP offer.
 * @param iceCandidates  ICE candidates from offer creation.
 * @param fingerprint    Desktop's DTLS certificate fingerprint.
 */
export async function initiatePairing(
  offerSdp: string,
  iceCandidates: string[],
  fingerprint: string,
): Promise<{
  qrPayload: PairingQrPayload;
  offerSdp: string;
  waitForAnswer: () => Promise<PairingAnswer>;
}> {
  // Cancel any existing pairing
  cancelPairing();

  const server = await startPairingServer({
    offerSdp,
    iceCandidates,
    fingerprint,
  });

  // The desktop's WebRTC parameters go IN the QR (Phase 19, finding 18).
  //
  // v4 put a pointer here and had the phone fetch the offer over plaintext
  // HTTP, where anyone on the network could read it for the sixty seconds the
  // window was open. A QR is out-of-band — the user is looking at their own
  // screen — so the parameters, including the fingerprint that authenticates
  // this machine, travel by it instead.
  const qrPayload: PairingQrPayload = {
    v: 5,
    hs: server.addresses,       // every reachable host — LAN and VPN alike
    p: server.port,
    c: server.code,
    iu: server.sdpParams.iu,
    ip: server.sdpParams.ip,
    fp: stripColonFingerprint(server.sdpParams.fp),
    cp: server.sdpParams.candidatePort,
    mms: server.sdpParams.maxMessageSize,
    n: server.nonce,
  };

  console.log(
    `[Pairing] v5 initiated — code=${server.code} ` +
    `addr=${server.address}:${server.port} qr=${JSON.stringify(qrPayload).length}B`,
  );

  activePairing = {
    server,
    desktopFingerprint: fingerprint,
    offerSdp,
    answer: null,
    confirmCode: null,
    sharedSecret: server.sharedSecret,
  };

  // Wrap the answer promise to store the answer + derive confirm code
  const wrappedWait = async (): Promise<PairingAnswer> => {
    const answer = await server.waitForAnswer();
    if (activePairing) {
      activePairing.answer = answer;
      activePairing.confirmCode = deriveConfirmationCode(
        server.nonce,
        fingerprint,
        answer.fingerprint,
      );
    }
    return answer;
  };

  return {
    qrPayload,
    offerSdp,
    waitForAnswer: wrappedWait,
  };
}

/**
 * Get the confirmation code for the active pairing session.
 * Available after the phone's answer has been received.
 */
export function getConfirmationCode(): string | null {
  return activePairing?.confirmCode ?? null;
}

/**
 * Get the stored offer SDP for the active pairing session.
 */
export function getStoredOfferSdp(): string | null {
  return activePairing?.offerSdp ?? null;
}

/**
 * Get the received answer for the active pairing session.
 */
export function getStoredAnswer(): PairingAnswer | null {
  return activePairing?.answer ?? null;
}

/**
 * Get the desktop fingerprint for the active pairing session.
 */
export function getDesktopFingerprint(): string | null {
  return activePairing?.desktopFingerprint ?? null;
}

/**
 * Get the nonce for the active pairing session.
 */
export function getPairingNonce(): string | null {
  return activePairing?.server.nonce ?? null;
}

/**
 * Get the pairingId for the active pairing session.
 */
export function getPairingId(): string | null {
  return activePairing?.server.pairingId ?? null;
}

/**
 * Confirm the pairing. Verifies the user-entered confirmation code
 * matches the derived code, then stores the paired device.
 *
 * @param userCode     Code the user read from their phone and entered.
 * @param deviceAlias  Human-readable name for the device.
 * @param deviceType   Desktop, mobile, or unknown.
 */
export function confirmPairing(
  userCode: string,
  deviceAlias: string,
  deviceType: 'desktop' | 'mobile' | 'unknown',
): PairedDevice | null {
  if (!activePairing?.answer || !activePairing.confirmCode) {
    console.warn('[Pairing] No answer received yet — cannot confirm');
    return null;
  }

  // Verify confirmation code
  if (userCode !== activePairing.confirmCode) {
    console.warn('[Pairing] Confirmation code mismatch');
    return null;
  }

  const now = new Date().toISOString();
  const device: PairedDevice = {
    fingerprint: activePairing.answer.fingerprint,
    pairingId: activePairing.server.pairingId,
    alias: deviceAlias,
    deviceType,
    pairedAt: now,
    lastConnected: null,
    // A REAL SECRET, not the `''` with a `// TODO` beside it that every record
    // used to carry (Phase 19, finding 1.2). Reconnect now requires a proof
    // computed with this; a `pairingId` on its own no longer gets in.
    sharedSecret: activePairing.sharedSecret,
    instanceId: null,
    // Pairing a phone does not hand it a shell or the settings that control
    // network exposure — those are granted per device, afterwards (finding 17).
    capabilities: [...DEFAULT_GRANTS],
    confirmedAt: now,
  };

  upsertPairedDevice(device);
  console.log(`[Pairing] Confirmed — device "${deviceAlias}" (${device.fingerprint.slice(0, 12)}…)`);

  // Hand the secret over the DTLS channel, never over the pairing server.
  //
  // This is the one moment it is transmitted, and it happens after the user
  // has compared the two confirmation codes — so by now they have asserted
  // that the connection carrying it reaches the device in their hand.
  deliverPairingSecret(device);

  // Clean up
  activePairing = null;

  return device;
}

/**
 * How long to keep trying to hand the secret to a phone that has confirmed
 * but whose control channel has not opened yet.
 */
const SECRET_DELIVERY_WINDOW_MS = 60_000;

/**
 * Give the phone the secret it will need to reconnect.
 *
 * NOT A SINGLE ATTEMPT. Confirmation and channel-open are independent events:
 * the user can type the code the instant it appears, while the DTLS handshake
 * and SCTP negotiation are still finishing — and over a VPN that gap is
 * seconds, not milliseconds. A one-shot send loses the race intermittently,
 * and the failure is invisible until the phone tries to reconnect days later
 * and is refused.
 *
 * `createChannel` re-emits `connected` every time a data channel opens, so
 * that is the signal to retry on.
 */
function deliverPairingSecret(device: PairedDevice): void {
  const payload = JSON.stringify({
    type: 'pairing.secret',
    pairingId: device.pairingId,
    secret: device.sharedSecret,
  });

  if (sendToPeer(device.fingerprint, DATA_CHANNELS.CONTROL, payload)) {
    console.log(`[Pairing] Delivered the reconnect secret to "${device.alias}"`);
    touchPairedDevice(device.fingerprint);
    return;
  }

  console.log(`[Pairing] Control channel not open yet — will hand "${device.alias}" its secret when it is`);

  let settled = false;
  const finish = (ok: boolean) => {
    if (settled) return;
    settled = true;
    unsubscribe();
    clearTimeout(timer);
    if (ok) {
      console.log(`[Pairing] Delivered the reconnect secret to "${device.alias}"`);
      // Delivering it over the data channel IS a successful conversation with
      // this device, so record it. Without this the pairing path never set
      // `lastConnected` — `touchPairedDevice` only fires on a connection state
      // change, and during pairing that change happens BEFORE the device is
      // stored. Every freshly paired phone then read "Never connected"
      // forever, which is the opposite of what just happened.
      touchPairedDevice(device.fingerprint);
    } else {
      // The desktop's record is sound; the phone's is not. Say which, because
      // "pair again" is the only fix and the user should hear it now.
      console.warn(
        `[Pairing] Never managed to deliver the reconnect secret to "${device.alias}" — ` +
        'that device will have to pair again.',
      );
    }
  };

  const unsubscribe = onConnectionStateChange((fingerprint, state) => {
    if (fingerprint !== device.fingerprint || state !== 'connected') return;
    if (sendToPeer(device.fingerprint, DATA_CHANNELS.CONTROL, payload)) finish(true);
  });

  const timer = setTimeout(() => finish(false), SECRET_DELIVERY_WINDOW_MS);
  if (typeof timer === 'object' && timer && 'unref' in timer) {
    (timer as unknown as { unref: () => void }).unref();
  }
}

/**
 * Cancel any active pairing session.
 */
export function cancelPairing(): void {
  if (activePairing) {
    activePairing.server.stop();
    activePairing = null;
    console.log('[Pairing] Cancelled');
  } else {
    stopPairingServer(); // Safety: stop orphaned server
  }
}

/**
 * Whether a pairing session is currently active.
 * Returns true if we have an active pairing state — even after the
 * temp server closes (it closes once the answer is received, but the
 * user still needs to confirm the code on the desktop).
 */
export function isPairingActive(): boolean {
  return activePairing !== null;
}
