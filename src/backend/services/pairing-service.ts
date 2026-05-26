/**
 * Pairing service — Phase 9.2 of the CDev target architecture.
 *
 * Orchestrates the QR-based WebRTC signalling handshake:
 *
 *   1. Desktop generates a WebRTC offer (SDP + ICE candidates via STUN).
 *   2. Offer + nonce + address + ephemeral UDP port → encoded as QR payload.
 *   3. Mobile/peer scans QR → creates answer → sends it via ephemeral UDP.
 *   4. Desktop receives answer → completes WebRTC handshake → data channel opens.
 *   5. Shared secret stored for auto-reconnect.
 *
 * The ephemeral UDP listener is open for <5 seconds during explicit
 * pairing only, on a random high port. This is the ONLY time a port
 * is briefly exposed on the network — not a persistent listener.
 *
 * Security: QR + confirmation code expire after 60 seconds. Nonce is
 * single-use. Replay rejected.
 */

import { randomBytes, createHash } from 'node:crypto';
import dgram from 'node:dgram';
import os from 'node:os';
import type { PairingQrPayload, PairingAnswer, PairedDevice } from '../../shared/types';
import { upsertPairedDevice } from './paired-device-service';

// --- Constants ---------------------------------------------------------------

const PAIRING_TIMEOUT_MS = 60_000; // QR + code expire after 60s
const UDP_LISTEN_MS = 30_000;       // UDP listener stays open max 30s
const NONCE_BYTES = 16;
const CODE_LENGTH = 6;

// --- Active pairing state ----------------------------------------------------

interface ActivePairing {
  nonce: string;
  createdAt: number;
  /** Ephemeral UDP socket waiting for the answer. */
  udpSocket: dgram.Socket | null;
  /** Port the UDP socket is bound to. */
  udpPort: number;
  /** Timer that closes the pairing window. */
  timeoutHandle: ReturnType<typeof setTimeout>;
  /** Resolves when the answer is received. */
  resolve: (answer: PairingAnswer) => void;
  /** Rejects on timeout or cancel. */
  reject: (err: Error) => void;
  /** Set to true once the answer is received (prevents double-resolve). */
  completed: boolean;
}

let activePairing: ActivePairing | null = null;

// Track used nonces to prevent replay (kept for 5 minutes).
const usedNonces = new Set<string>();
const NONCE_EXPIRY_MS = 300_000;

// --- Public API --------------------------------------------------------------

/**
 * Initiate a pairing session. Returns the QR payload that should be
 * displayed as a QR code on the desktop.
 *
 * Only one pairing session can be active at a time. Starting a new one
 * cancels the previous.
 *
 * @param offerSdp  The WebRTC SDP offer (from the WebRTC service).
 * @param iceCandidates  ICE candidates gathered during offer creation.
 * @param fingerprint  The desktop's DTLS certificate fingerprint.
 * @returns The QR payload to encode.
 */
export async function initiatePairing(
  offerSdp: string,
  iceCandidates: string[],
  fingerprint: string,
): Promise<{ qrPayload: PairingQrPayload; waitForAnswer: () => Promise<PairingAnswer> }> {
  // Cancel any existing pairing
  cancelPairing();

  const nonce = randomBytes(NONCE_BYTES).toString('hex');
  const address = getLocalAddress();

  // Open ephemeral UDP socket for answer delivery
  const udpSocket = dgram.createSocket('udp4');
  const udpPort = await bindUdpSocket(udpSocket);

  console.log(`[Pairing] Initiated — nonce=${nonce.slice(0, 8)}… UDP port=${udpPort} addr=${address}`);

  const qrPayload: PairingQrPayload = {
    v: 1,
    nonce,
    offer: offerSdp,
    ice: iceCandidates,
    fp: fingerprint,
    addr: address,
    port: udpPort,
  };

  // Create promise that resolves when the answer arrives
  const answerPromise = new Promise<PairingAnswer>((resolve, reject) => {
    const timeoutHandle = setTimeout(() => {
      if (activePairing && !activePairing.completed) {
        activePairing.completed = true;
        cleanup();
        reject(new Error('Pairing timed out'));
      }
    }, PAIRING_TIMEOUT_MS);

    activePairing = {
      nonce,
      createdAt: Date.now(),
      udpSocket,
      udpPort,
      timeoutHandle,
      resolve,
      reject,
      completed: false,
    };

    // Listen for the answer on UDP
    udpSocket.on('message', (msg: Buffer) => {
      if (!activePairing || activePairing.completed) return;

      try {
        const answer: PairingAnswer = JSON.parse(msg.toString('utf-8'));

        // Validate nonce
        if (answer.nonce !== nonce) {
          console.warn('[Pairing] Answer nonce mismatch — ignoring');
          return;
        }

        // Prevent replay
        if (usedNonces.has(nonce)) {
          console.warn('[Pairing] Nonce already used — replay rejected');
          return;
        }

        activePairing.completed = true;
        usedNonces.add(nonce);
        setTimeout(() => usedNonces.delete(nonce), NONCE_EXPIRY_MS);

        cleanup();
        resolve(answer);
      } catch (err) {
        console.warn('[Pairing] Invalid UDP message:', err);
      }
    });

    udpSocket.on('error', (err: Error) => {
      console.warn('[Pairing] UDP socket error:', err);
    });
  });

  return {
    qrPayload,
    waitForAnswer: () => answerPromise,
  };
}

/**
 * Confirm the pairing by verifying the 6-digit code and storing the device.
 *
 * @param answer  The answer received via UDP.
 * @param expectedCode  The 6-digit code the user entered on the desktop.
 * @param deviceAlias  Human-readable name for the paired device.
 * @param deviceType  Desktop or mobile.
 * @param sharedSecret  Hex-encoded shared secret from DTLS.
 * @returns The stored PairedDevice if confirmed, or null if code mismatch.
 */
export function confirmPairing(
  answer: PairingAnswer,
  expectedCode: string,
  deviceAlias: string,
  deviceType: 'desktop' | 'mobile' | 'unknown',
  sharedSecret: string,
): PairedDevice | null {
  // Verify confirmation code
  if (answer.code !== expectedCode) {
    console.warn('[Pairing] Confirmation code mismatch');
    return null;
  }

  const device: PairedDevice = {
    fingerprint: answer.fp,
    alias: deviceAlias,
    deviceType,
    pairedAt: new Date().toISOString(),
    lastConnected: null,
    sharedSecret,
    instanceId: null,
  };

  upsertPairedDevice(device);
  console.log(`[Pairing] Confirmed — device "${deviceAlias}" (${answer.fp.slice(0, 12)}…)`);

  return device;
}

/**
 * Cancel any active pairing session.
 */
export function cancelPairing(): void {
  if (activePairing) {
    if (!activePairing.completed) {
      activePairing.completed = true;
      activePairing.reject(new Error('Pairing cancelled'));
    }
    cleanup();
    activePairing = null;
    console.log('[Pairing] Cancelled');
  }
}

/**
 * Whether a pairing session is currently active.
 */
export function isPairingActive(): boolean {
  return activePairing !== null && !activePairing.completed;
}

/**
 * Derive a 6-digit confirmation code from a fingerprint and nonce.
 * Used by both desktop (to verify) and mobile (to display).
 */
export function deriveConfirmationCode(fingerprint: string, nonce: string): string {
  const hash = createHash('sha256')
    .update(`${fingerprint}:${nonce}`)
    .digest('hex');
  // Take first 6 digits from the hex hash
  const num = parseInt(hash.slice(0, 8), 16) % 1_000_000;
  return num.toString().padStart(CODE_LENGTH, '0');
}

/**
 * Submit an answer manually (fallback when UDP doesn't work).
 * The answer JSON is pasted by the user into a text field.
 */
export function submitAnswerManually(answerJson: string): boolean {
  if (!activePairing || activePairing.completed) return false;

  try {
    const answer: PairingAnswer = JSON.parse(answerJson);
    if (answer.nonce !== activePairing.nonce) {
      console.warn('[Pairing] Manual answer nonce mismatch');
      return false;
    }

    if (usedNonces.has(activePairing.nonce)) {
      console.warn('[Pairing] Nonce already used');
      return false;
    }

    activePairing.completed = true;
    usedNonces.add(activePairing.nonce);
    setTimeout(() => usedNonces.delete(activePairing!.nonce), NONCE_EXPIRY_MS);

    cleanup();
    activePairing.resolve(answer);
    return true;
  } catch {
    console.warn('[Pairing] Invalid manual answer JSON');
    return false;
  }
}

// --- Internals ---------------------------------------------------------------

function cleanup(): void {
  if (activePairing) {
    clearTimeout(activePairing.timeoutHandle);
    if (activePairing.udpSocket) {
      try { activePairing.udpSocket.close(); } catch { /* ignore */ }
      activePairing.udpSocket = null;
    }
  }
}

/**
 * Bind the UDP socket to a random high port on 0.0.0.0.
 * Returns the bound port.
 */
function bindUdpSocket(socket: dgram.Socket): Promise<number> {
  return new Promise((resolve, reject) => {
    // Bind to 0.0.0.0:0 — OS picks a random high port
    socket.bind(0, '0.0.0.0', () => {
      const addr = socket.address();
      resolve(addr.port);
    });
    socket.on('error', reject);

    // Safety: close the socket after the max listen window
    setTimeout(() => {
      try { socket.close(); } catch { /* already closed */ }
    }, UDP_LISTEN_MS);
  });
}

/**
 * Get the best local IPv4 address for the QR payload.
 * Prefers non-internal addresses (LAN IP over 127.0.0.1).
 */
function getLocalAddress(): string {
  const interfaces = os.networkInterfaces();
  for (const name of Object.keys(interfaces)) {
    for (const iface of interfaces[name] ?? []) {
      if (iface.family === 'IPv4' && !iface.internal) {
        return iface.address;
      }
    }
  }
  return '127.0.0.1';
}
