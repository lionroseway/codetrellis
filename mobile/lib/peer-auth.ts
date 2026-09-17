/**
 * The phone's half of peer authentication (Phase 19, finding 1.2).
 *
 * A standalone mirror of the desktop's `src/backend/services/peer-auth.ts`.
 * The mobile app is a separate Expo project and cannot import from the desktop
 * workspace — the same arrangement as `sdp-minimal.ts`. The two MUST agree
 * byte for byte, and `tests/e2e/mobile-desktop-parity.test.ts` in the desktop
 * repo asserts that they do.
 *
 * WHAT THE PHONE IS RESPONSIBLE FOR HERE
 *
 *   - answering the desktop's reconnect challenge with the secret agreed at
 *     pairing, instead of presenting a `pairingId` and being believed;
 *   - deriving the confirmation code ITSELF. It used to display the number
 *     the desktop sent it, so the user compared the desktop's code against the
 *     desktop's code — a relay in the middle supplies both screens and the
 *     ceremony confirms nothing.
 */

import { hmacSha256Hex, sha256Hex, toHex, utf8Bytes } from './crypto';

/**
 * The exact bytes both sides sign.
 *
 * Fields are newline-separated so no two different splits produce the same
 * string. Mirrors `canonicalChallenge` on the desktop.
 */
export function canonicalChallenge(pairingId: string, nonce: string, expiresAt: number): string {
  return ['ct-peer-auth:v1', pairingId, nonce, String(expiresAt)].join('\n');
}

/** Answer a reconnect challenge. */
export function computeChallengeMac(
  secretHex: string,
  pairingId: string,
  nonce: string,
  expiresAt: number,
): string {
  if (!isUsableSecret(secretHex)) {
    throw new Error('This desktop was paired before reconnect authentication existed — pair again');
  }
  return hmacSha256Hex(secretHex, canonicalChallenge(pairingId, nonce, expiresAt));
}

/** Whether a stored secret can actually be used. Older records hold `''`. */
export function isUsableSecret(secret: string | undefined | null): secret is string {
  return typeof secret === 'string' && /^[0-9a-f]{64,}$/i.test(secret);
}

/**
 * Prove to the desktop that we saw the QR, without sending the code.
 *
 * The pairing code used to travel in the `POST /answer` body verbatim, where
 * anyone on the network read it off the wire (Phase 19, finding 18). We sign
 * the session nonce and our own fingerprint with it instead.
 *
 * Mirrors `computeAnswerMac` on the desktop.
 */
export function computeAnswerMac(code: string, nonce: string, fingerprint: string): string {
  return hmacSha256Hex(
    toHex(utf8Bytes(String(code))),
    ['ct-pair:v5', nonce, normaliseFp(fingerprint)].join('\n'),
  );
}

/**
 * The 6-digit code shown during pairing.
 *
 * Derived from the nonce and the two DTLS fingerprints as each device
 * OBSERVES them — the desktop's comes out of the offer SDP the phone actually
 * received, not out of a field the desktop asserted. A relay terminating both
 * legs therefore shows two different numbers while the user is looking at both
 * screens, which is the entire security value of the step.
 *
 * Mirrors `deriveConfirmationCode` on the desktop, including the
 * normalisation: the two codebases format fingerprints differently, and a
 * colon or case difference must not change the number.
 */
export function deriveConfirmationCode(
  nonce: string,
  fingerprintA: string,
  fingerprintB: string,
): string {
  const sorted = [normaliseFp(fingerprintA), normaliseFp(fingerprintB)].sort();
  const hash = sha256Hex(`${nonce}:${sorted[0]}:${sorted[1]}`);
  return (parseInt(hash.slice(0, 8), 16) % 1000000).toString().padStart(6, '0');
}

function normaliseFp(fp: string): string {
  return String(fp ?? '').replace(/[^0-9A-Fa-f]/g, '').toUpperCase();
}
