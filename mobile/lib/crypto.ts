/**
 * Crypto utilities for the mobile app.
 *
 * React Native doesn't have Node's `crypto` module. We use the
 * Web Crypto API (available in Hermes via react-native polyfills)
 * or a simple fallback hash for the confirmation code.
 */

/**
 * SHA-256 hash of a string, returned as hex.
 *
 * Uses the SubtleCrypto API if available (modern React Native
 * with Hermes), otherwise falls back to a simple hash.
 */
export async function createHash(input: string): Promise<string> {
  // Try SubtleCrypto first (available in newer Hermes builds)
  if (typeof globalThis.crypto?.subtle?.digest === 'function') {
    const encoder = new TextEncoder();
    const data = encoder.encode(input);
    const hashBuffer = await globalThis.crypto.subtle.digest('SHA-256', data);
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    return hashArray.map((b) => b.toString(16).padStart(2, '0')).join('');
  }

  // Fallback: a simple deterministic hash (not cryptographic, but
  // sufficient for the 6-digit confirmation code which is just a UX
  // convenience, not a security primitive — the real auth is the
  // DTLS fingerprint exchange).
  return simpleHash(input);
}

/**
 * Simple deterministic hash — produces a 64-char hex string.
 * NOT cryptographically secure. Used only as a fallback for
 * deriving the 6-digit confirmation code.
 */
function simpleHash(str: string): string {
  let h1 = 0xdeadbeef;
  let h2 = 0x41c6ce57;

  for (let i = 0; i < str.length; i++) {
    const ch = str.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }

  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507);
  h1 ^= Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507);
  h2 ^= Math.imul(h1 ^ (h1 >>> 13), 3266489909);

  // Produce 64 hex chars by repeating and mixing
  const a = (h1 >>> 0).toString(16).padStart(8, '0');
  const b = (h2 >>> 0).toString(16).padStart(8, '0');
  const c = ((h1 ^ h2) >>> 0).toString(16).padStart(8, '0');
  const d = ((h1 + h2) >>> 0).toString(16).padStart(8, '0');

  return (a + b + c + d + a + b + c + d).slice(0, 64);
}
