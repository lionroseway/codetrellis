/**
 * SHA-256 and HMAC-SHA256 for the mobile app.
 *
 * WHY THIS IS HAND-WRITTEN
 *
 * React Native has no `node:crypto`, and Hermes does not ship `crypto.subtle`
 * — `crypto.getRandomValues` exists, the SubtleCrypto surface does not. So the
 * previous version of this file tried `globalThis.crypto.subtle.digest` and,
 * when it was missing (which is always, in this runtime), fell back to a
 * 64-bit integer mixer it described as "not cryptographic, but sufficient for
 * the 6-digit confirmation code which is just a UX convenience".
 *
 * That was wrong on both counts. The confirmation code is the only thing
 * standing between the user and a relayed pairing, and a mixer of that shape
 * is trivial to collide — an attacker can pick a certificate whose fingerprint
 * lands on the code the other screen is showing. And the same primitive is now
 * load-bearing for the reconnect proof.
 *
 * Pure JS rather than a native module: adding one means an EAS rebuild and a
 * platform dependency for something that is sixty lines of well-specified
 * arithmetic. `mobile-desktop-parity.test.ts` checks every function here
 * against Node's `crypto` so a transcription slip cannot go unnoticed.
 *
 * Constant time: this is NOT. It is used to PRODUCE proofs, not to verify
 * them — the desktop does the comparing, in constant time, in `peer-auth.ts`.
 */

// --- SHA-256 -----------------------------------------------------------------

/** FIPS 180-4 round constants: cube roots of the first 64 primes. */
const K = new Uint32Array([
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
  0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
  0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
  0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
  0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
  0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
  0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
  0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
]);

const rotr = (x: number, n: number): number => (x >>> n) | (x << (32 - n));

/** SHA-256 over raw bytes. */
export function sha256(input: Uint8Array): Uint8Array {
  const h = new Uint32Array([
    0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a,
    0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19,
  ]);

  // Pad: 0x80, zeros, then the 64-bit big-endian bit length.
  const bitLen = input.length * 8;
  // Round UP to the next whole block that fits the byte, the zeros and the
  // 8-byte length — not one block further. An over-long buffer is not merely
  // wasteful: it moves the length field and changes the digest, and it only
  // does so for inputs that land exactly on a boundary (55, 119, …), which is
  // why the parity test walks those specific lengths.
  const withPad = new Uint8Array(((input.length + 9 + 63) >> 6) << 6);
  withPad.set(input);
  withPad[input.length] = 0x80;
  // Lengths here are far below 2^32 bits, so the high word is always zero.
  const dv = new DataView(withPad.buffer);
  dv.setUint32(withPad.length - 4, bitLen >>> 0, false);
  dv.setUint32(withPad.length - 8, Math.floor(bitLen / 0x100000000), false);

  const w = new Uint32Array(64);

  for (let offset = 0; offset < withPad.length; offset += 64) {
    for (let i = 0; i < 16; i++) w[i] = dv.getUint32(offset + i * 4, false);
    for (let i = 16; i < 64; i++) {
      const s0 = rotr(w[i - 15], 7) ^ rotr(w[i - 15], 18) ^ (w[i - 15] >>> 3);
      const s1 = rotr(w[i - 2], 17) ^ rotr(w[i - 2], 19) ^ (w[i - 2] >>> 10);
      w[i] = (w[i - 16] + s0 + w[i - 7] + s1) >>> 0;
    }

    let [a, b, c, d, e, f, g, hh] = [h[0], h[1], h[2], h[3], h[4], h[5], h[6], h[7]];

    for (let i = 0; i < 64; i++) {
      const S1 = rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25);
      const ch = (e & f) ^ (~e & g);
      const t1 = (hh + S1 + ch + K[i] + w[i]) >>> 0;
      const S0 = rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22);
      const maj = (a & b) ^ (a & c) ^ (b & c);
      const t2 = (S0 + maj) >>> 0;

      hh = g; g = f; f = e;
      e = (d + t1) >>> 0;
      d = c; c = b; b = a;
      a = (t1 + t2) >>> 0;
    }

    h[0] = (h[0] + a) >>> 0; h[1] = (h[1] + b) >>> 0;
    h[2] = (h[2] + c) >>> 0; h[3] = (h[3] + d) >>> 0;
    h[4] = (h[4] + e) >>> 0; h[5] = (h[5] + f) >>> 0;
    h[6] = (h[6] + g) >>> 0; h[7] = (h[7] + hh) >>> 0;
  }

  const out = new Uint8Array(32);
  const outView = new DataView(out.buffer);
  for (let i = 0; i < 8; i++) outView.setUint32(i * 4, h[i], false);
  return out;
}

// --- HMAC --------------------------------------------------------------------

const BLOCK_BYTES = 64;

/** HMAC-SHA256, RFC 2104. */
export function hmacSha256(key: Uint8Array, message: Uint8Array): Uint8Array {
  // A key longer than the block is hashed first; a shorter one is zero-padded.
  const k = key.length > BLOCK_BYTES ? sha256(key) : key;
  const padded = new Uint8Array(BLOCK_BYTES);
  padded.set(k);

  const inner = new Uint8Array(BLOCK_BYTES + message.length);
  const outer = new Uint8Array(BLOCK_BYTES + 32);
  for (let i = 0; i < BLOCK_BYTES; i++) {
    inner[i] = padded[i] ^ 0x36;
    outer[i] = padded[i] ^ 0x5c;
  }
  inner.set(message, BLOCK_BYTES);
  outer.set(sha256(inner), BLOCK_BYTES);
  return sha256(outer);
}

// --- Encoding ----------------------------------------------------------------

export function utf8Bytes(s: string): Uint8Array {
  // TextEncoder exists in Hermes; the manual path is a safety net for older
  // runtimes and only has to handle the BMP, which is all our inputs contain.
  if (typeof TextEncoder !== 'undefined') return new TextEncoder().encode(s);

  const out: number[] = [];
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    if (c < 0x80) out.push(c);
    else if (c < 0x800) out.push(0xc0 | (c >> 6), 0x80 | (c & 0x3f));
    else out.push(0xe0 | (c >> 12), 0x80 | ((c >> 6) & 0x3f), 0x80 | (c & 0x3f));
  }
  return new Uint8Array(out);
}

export function toHex(bytes: Uint8Array): string {
  let out = '';
  for (let i = 0; i < bytes.length; i++) out += bytes[i].toString(16).padStart(2, '0');
  return out;
}

export function fromHex(hex: string): Uint8Array {
  const clean = hex.length % 2 === 0 ? hex : `0${hex}`;
  const out = new Uint8Array(clean.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(clean.slice(i * 2, i * 2 + 2), 16);
  return out;
}

/** SHA-256 of a UTF-8 string, hex. */
export function sha256Hex(input: string): string {
  return toHex(sha256(utf8Bytes(input)));
}

/** HMAC-SHA256 with a hex-encoded key over a UTF-8 string, hex. */
export function hmacSha256Hex(keyHex: string, message: string): string {
  return toHex(hmacSha256(fromHex(keyHex), utf8Bytes(message)));
}
