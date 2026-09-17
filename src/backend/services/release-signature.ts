/**
 * Checking that a release manifest is one we published.
 *
 * Phase 19, finding 23 — the half that verified downloads did not close.
 *
 * WHAT WAS STILL MISSING
 *
 * `update-download-service` verifies an installer against a sha256, which
 * proves the bytes are the ones GITHUB published. It does not prove they are
 * ours. Anyone who took over the releases repo — a leaked token, a bad PAT —
 * would publish a binary and a matching digest together, and every check would
 * pass, because the digest and the file come from the same place.
 *
 * A signed manifest removes GitHub from the chain. The digests are listed in
 * `SHA256SUMS`, that file is signed with a key held on one machine and never
 * in CI, and the public half ships inside the app.
 *
 * WHY Ed25519 AND NOT THE APPLE CERTIFICATE
 *
 * Different jobs. The Developer ID certificate proves the app to macOS
 * Gatekeeper; it signs bundles, not arbitrary files, and says nothing to a
 * Windows or Linux user. This signs a text file, is verified by `node:crypto`
 * with no dependency, and works identically on every platform.
 */

import { createPublicKey, verify as cryptoVerify } from 'node:crypto';
import { RELEASE_PUBLIC_KEY_PEM } from './release-public-key';

export interface ManifestEntry {
  sha256: string;
  filename: string;
}

/**
 * Parse `shasum -a 256` output.
 *
 * Deliberately the standard format rather than something bespoke: a user who
 * does not trust our verification can run `shasum -c SHA256SUMS` themselves,
 * which is worth more than a format only we can read.
 */
export function parseManifest(text: string): ManifestEntry[] {
  const out: ManifestEntry[] = [];
  for (const raw of String(text ?? '').split('\n')) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    // "<64 hex>  <filename>" — one or two spaces, optional binary marker "*".
    const m = /^([0-9a-fA-F]{64})\s+\*?(.+)$/.exec(line);
    if (!m) continue;
    out.push({ sha256: m[1].toLowerCase(), filename: m[2].trim() });
  }
  return out;
}

/**
 * Is this manifest signed by us?
 *
 * `signatureBase64` is a detached Ed25519 signature over the manifest's raw
 * bytes. Returns false rather than throwing on anything malformed — a bad
 * signature and a corrupt one are the same answer to the caller, and the
 * difference is not something to branch on.
 */
export function verifyManifestSignature(manifest: Buffer | string, signatureBase64: string): boolean {
  try {
    if (!signatureBase64 || typeof signatureBase64 !== 'string') return false;
    const signature = Buffer.from(signatureBase64.trim(), 'base64');
    // Ed25519 signatures are exactly 64 bytes. A wrong length means the input
    // was never a signature, and base64 decoding is forgiving enough to
    // produce something from almost anything.
    if (signature.length !== 64) return false;

    const key = createPublicKey(RELEASE_PUBLIC_KEY_PEM);
    const data = Buffer.isBuffer(manifest) ? manifest : Buffer.from(manifest, 'utf-8');
    // Ed25519 signs the message directly — no digest algorithm argument, which
    // is one fewer thing to get wrong than the RSA/ECDSA path.
    return cryptoVerify(null, data, key, signature);
  } catch {
    return false;
  }
}

/** The digest this manifest publishes for one file, if it names it. */
export function digestFor(entries: ManifestEntry[], filename: string): string | null {
  const wanted = String(filename ?? '').trim();
  if (!wanted) return null;
  const hit = entries.find((e) => e.filename === wanted);
  return hit ? hit.sha256 : null;
}

/** Exposed so tests can prove the key in the repo is the one being used. */
export const _publicKeyPem = RELEASE_PUBLIC_KEY_PEM;
