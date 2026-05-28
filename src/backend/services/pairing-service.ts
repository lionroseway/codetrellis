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
  isPairingServerActive,
  deriveConfirmationCode,
  type PairingAnswer,
  type PairingServerResult,
} from './pairing-server';
import { upsertPairedDevice } from './paired-device-service';

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

  console.log(
    `[Pairing] v4 initiated — code=${server.code} ` +
    `addr=${server.address}:${server.port}`,
  );

  const qrPayload: PairingQrPayload = {
    v: 4,
    h: server.address,
    p: server.port,
    c: server.code,
  };

  activePairing = {
    server,
    desktopFingerprint: fingerprint,
    offerSdp,
    answer: null,
    confirmCode: null,
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

  const device: PairedDevice = {
    fingerprint: activePairing.answer.fingerprint,
    alias: deviceAlias,
    deviceType,
    pairedAt: new Date().toISOString(),
    lastConnected: null,
    sharedSecret: '', // TODO: extract from DTLS handshake
    instanceId: null,
  };

  upsertPairedDevice(device);
  console.log(`[Pairing] Confirmed — device "${deviceAlias}" (${device.fingerprint.slice(0, 12)}…)`);

  // Clean up
  activePairing = null;

  return device;
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
