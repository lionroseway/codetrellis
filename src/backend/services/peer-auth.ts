/**
 * Proving a reconnecting device is the one that was paired.
 *
 * Phase 19, finding 1.2.
 *
 * WHAT WAS WRONG
 *
 * `PairedDevice.sharedSecret` was declared, documented as "derived from the
 * DTLS handshake during initial pairing", and written as the empty string with
 * a `// TODO` next to it. Nothing ever read it. So the only thing a
 * reconnecting caller had to present was a `pairingId` — a value the phone
 * sends, in the clear, to whatever address it believes is the desktop, on
 * every reconnect attempt. Knowing it was sufficient to be treated as the
 * paired device.
 *
 * WHAT THIS IS
 *
 * A pre-shared key established once at pairing, and a challenge-response over
 * it on every reconnect:
 *
 *   1. the phone asks for a challenge;
 *   2. the desktop returns a random single-use nonce with an expiry;
 *   3. the phone returns HMAC-SHA256(secret, canonical(pairingId, nonce, exp));
 *   4. the desktop recomputes, compares in constant time, and CONSUMES the
 *      nonce so the same proof cannot be replayed.
 *
 * WHERE THE SECRET COMES FROM, AND WHY NOT OVER HTTP
 *
 * The pairing exchange runs over plaintext HTTP on the LAN, so anything sent
 * through it is readable by anyone on that network for the 60 seconds the
 * pairing server is open. A secret delivered that way would be a secret the
 * eavesdropper also holds, and the whole mechanism would be theatre.
 *
 * So it is NOT sent over the pairing server. It is generated on the desktop
 * and delivered over the `control` data channel once WebRTC is up — DTLS, so
 * confidential against a passive observer. An ACTIVE attacker who relayed the
 * pairing exchange would terminate that DTLS themselves, and is caught instead
 * by the numeric comparison: both devices derive the confirmation code from
 * the certificates they actually see, so a relay makes the two codes differ
 * and the user is looking at both screens at that moment. That only works
 * because each side now derives the code itself — see `deriveConfirmationCode`
 * and its mobile mirror.
 */

import { createHmac, randomBytes, timingSafeEqual, createHash } from 'node:crypto';

/** How long an issued challenge stays usable. Short: the phone answers immediately. */
export const CHALLENGE_TTL_MS = 30_000;

/** Ceiling on outstanding challenges, so issuing them cannot exhaust memory. */
const MAX_OUTSTANDING = 256;

/** Bytes of entropy in the shared secret and in each challenge nonce. */
const SECRET_BYTES = 32;
const NONCE_BYTES = 32;

export class PeerAuthError extends Error {
  readonly code = 'EPEER_AUTH';
  constructor(message: string) {
    super(message);
    this.name = 'PeerAuthError';
  }
}

// --- Secret ------------------------------------------------------------------

/** A fresh pairing secret, hex-encoded. Never transmitted over the pairing HTTP server. */
export function generateSharedSecret(): string {
  return randomBytes(SECRET_BYTES).toString('hex');
}

/** Whether a stored secret is usable. Records written before 1.2 hold `''`. */
export function isUsableSecret(secret: string | undefined | null): secret is string {
  return typeof secret === 'string' && /^[0-9a-f]{64,}$/i.test(secret);
}

// --- Canonical message -------------------------------------------------------

/**
 * The exact bytes both sides sign.
 *
 * Every field that scopes the proof is in here and separated by a character
 * that cannot occur in any of them. Concatenating without a separator would
 * let two different field splits produce the same string, which is how a proof
 * for one pairing becomes a proof for another.
 *
 * The mobile mirror in `mobile/lib/peer-auth.ts` MUST produce the same string.
 */
export function canonicalChallenge(pairingId: string, nonce: string, expiresAt: number): string {
  return ['ct-peer-auth:v1', pairingId, nonce, String(expiresAt)].join('\n');
}

/** HMAC-SHA256 over the canonical message, hex. */
export function computeChallengeMac(
  secretHex: string,
  pairingId: string,
  nonce: string,
  expiresAt: number,
): string {
  if (!isUsableSecret(secretHex)) {
    throw new PeerAuthError('No usable pairing secret — the device must be paired again');
  }
  return createHmac('sha256', Buffer.from(secretHex, 'hex'))
    .update(canonicalChallenge(pairingId, nonce, expiresAt))
    .digest('hex');
}

/** Constant-time hex comparison that never throws on malformed input. */
export function macsEqual(a: string, b: string): boolean {
  if (typeof a !== 'string' || typeof b !== 'string') return false;
  if (a.length !== b.length || a.length === 0) return false;
  try {
    return timingSafeEqual(Buffer.from(a, 'utf-8'), Buffer.from(b, 'utf-8'));
  } catch {
    return false;
  }
}

/**
 * The phone's proof that it saw the QR, for `POST /answer`.
 *
 * The pairing code used to travel in that request body verbatim, where anyone
 * on the network read it off the wire (Phase 19, finding 18). The phone signs
 * the session nonce and its own fingerprint with the code instead.
 *
 * Six digits is a weak key by any normal standard. It does not need to be
 * strong: an observer who recovers it can only do so AFTER seeing this
 * request, and by then the offer is claimed and the session is answered. The
 * property being bought is that the code is not readable in flight, not that
 * it resists offline attack.
 *
 * Mirrored in `mobile/lib/peer-auth.ts`.
 */
export function computeAnswerMac(code: string, nonce: string, fingerprint: string): string {
  const normalised = String(fingerprint ?? '').replace(/[^0-9A-Fa-f]/g, '').toUpperCase();
  return createHmac('sha256', Buffer.from(String(code), 'utf-8'))
    .update(['ct-pair:v5', nonce, normalised].join('\n'))
    .digest('hex');
}

// --- Challenge store ---------------------------------------------------------

interface Challenge {
  pairingId: string;
  expiresAt: number;
}

/** nonce -> challenge. A nonce is removed the first time it is presented. */
const outstanding = new Map<string, Challenge>();

function purgeExpired(now: number): void {
  for (const [nonce, c] of outstanding) {
    if (c.expiresAt <= now) outstanding.delete(nonce);
  }
}

/**
 * Issue a challenge.
 *
 * Deliberately does NOT check that `pairingId` names a real device: replying
 * only to known ids would turn this into an oracle for enumerating them. An
 * unknown id gets a well-formed challenge it cannot answer.
 */
export function issueChallenge(pairingId: string, now = Date.now()): { nonce: string; expiresAt: number } {
  purgeExpired(now);

  // Oldest-first eviction under flood. The cap is far above any legitimate
  // number of phones, so reaching it means someone is spraying the endpoint.
  while (outstanding.size >= MAX_OUTSTANDING) {
    const oldest = outstanding.keys().next();
    if (oldest.done) break;
    outstanding.delete(oldest.value);
  }

  const nonce = randomBytes(NONCE_BYTES).toString('hex');
  const expiresAt = now + CHALLENGE_TTL_MS;
  outstanding.set(nonce, { pairingId, expiresAt });
  return { nonce, expiresAt };
}

/**
 * Verify a response and consume the nonce.
 *
 * The nonce is deleted on EVERY presentation, valid or not. A nonce that
 * survived a failed attempt would let an attacker grind MACs against it.
 */
export function verifyChallengeResponse(
  args: { pairingId: string; nonce: string; expiresAt: number; mac: string; secret: string },
  now = Date.now(),
): { ok: true } | { ok: false; reason: string } {
  purgeExpired(now);

  const issued = outstanding.get(args.nonce);
  // One shot, whatever happens next.
  outstanding.delete(args.nonce);

  if (!issued) return { ok: false, reason: 'unknown or already-used challenge' };
  if (issued.expiresAt <= now) return { ok: false, reason: 'challenge expired' };
  if (issued.pairingId !== args.pairingId) return { ok: false, reason: 'challenge was issued for a different device' };
  // The client echoes the expiry back and it is covered by the MAC, so a
  // mismatch means the message was altered; compare against what WE issued,
  // never against what was sent.
  if (issued.expiresAt !== args.expiresAt) return { ok: false, reason: 'expiry does not match the issued challenge' };
  if (!isUsableSecret(args.secret)) return { ok: false, reason: 'device has no pairing secret — re-pair required' };

  const expected = computeChallengeMac(args.secret, args.pairingId, args.nonce, issued.expiresAt);
  if (!macsEqual(expected, args.mac)) return { ok: false, reason: 'incorrect proof' };

  return { ok: true };
}

/** Test seam: forget every outstanding challenge. */
export function resetChallenges(): void {
  outstanding.clear();
}

/** Test seam: how many challenges are outstanding. */
export function outstandingChallengeCount(): number {
  return outstanding.size;
}

// --- Confirmation code -------------------------------------------------------

/**
 * The 6-digit code both devices display during pairing.
 *
 * Both sides compute this from values they each observe directly — the nonce
 * from the pairing exchange and the two DTLS fingerprints — so a relay that
 * terminates one connection and opens another shows the user two different
 * numbers. It is only meaningful because BOTH sides derive it: the desktop
 * used to compute it and send it to the phone, which displayed whatever it
 * received, so the comparison confirmed nothing about the phone's view.
 *
 * Mirrored in `mobile/lib/peer-auth.ts` — the two must agree exactly.
 */
export function deriveConfirmationCode(
  nonce: string,
  fingerprintA: string,
  fingerprintB: string,
): string {
  // Sorted so both sides agree regardless of who offered. Normalised so a
  // case or colon difference between implementations cannot change the code.
  const sorted = [normaliseFp(fingerprintA), normaliseFp(fingerprintB)].sort();
  const hash = createHash('sha256')
    .update(`${nonce}:${sorted[0]}:${sorted[1]}`)
    .digest('hex');
  return (parseInt(hash.slice(0, 8), 16) % 1_000_000).toString().padStart(6, '0');
}

function normaliseFp(fp: string): string {
  return String(fp ?? '').replace(/[^0-9A-Fa-f]/g, '').toUpperCase();
}
