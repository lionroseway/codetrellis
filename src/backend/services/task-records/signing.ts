/**
 * Signing task-state records (Phase 32 C3.3; shared-work doc C-3, "Trust").
 *
 * Anyone who can write to the project's files can write a record claiming to
 * be anyone, so a teammate's record was shown as "unverified" (C3.1). Each
 * record is now signed when it is written:
 *
 *  - with the person's git SSH key, when git signing is set up with one
 *    (`gpg.format ssh`, `user.signingkey`), the key C2.5b signs approvals
 *    with; checked on read against git's allowed signers, the list a team
 *    already keeps for signed commits;
 *  - else with a key the app makes for this device (Ed25519), introduced to
 *    teammates once: its public half is written to `.codetrellis/keys/`, and
 *    each teammate trusts it once, in Settings, comparing its fingerprint
 *    with the one this device shows. A key file is only an introduction:
 *    nothing it says is believed until the person trusts it.
 *
 * What is signed is the record's body as canonical JSON (keys sorted), so the
 * bytes signed are the bytes read back on any machine. Pure: no file is read
 * or written here, and the device key's private half never leaves the
 * database it is kept in.
 */

import crypto from 'node:crypto';
import { parse as parseYaml, stringify as stringifyYaml } from 'yaml';

/** ssh-keygen's namespace for task records: a signature made for anything else does not verify as one. */
export const RECORD_NAMESPACE = 'codetrellis-task-record';
export const KEY_KIND = 'codetrellis-device-key';
const MAX_KEY_BYTES = 4 * 1024;
const WRITER = /^[a-f0-9]{8,32}$/;
const FINGERPRINT = /^SHA256:[A-Za-z0-9+/]{43}$/;
const EMAIL = /^[^\s<>@]{1,64}@[^\s<>@]{1,255}$/;
const SSH_SIGNATURE = /^-----BEGIN SSH SIGNATURE-----\n[A-Za-z0-9+/=\n]+-----END SSH SIGNATURE-----$/;

/** How a record was signed, as its file says. A claim until it verifies. */
export type RecordSignature =
  | { how: 'device'; key: string; value: string }
  | { how: 'git'; signer: string; value: string };

/** Canonical JSON: keys sorted at every level, no spaces. */
export function canonicalJson(v: unknown): string {
  const sort = (x: unknown): unknown => {
    if (Array.isArray(x)) return x.map(sort);
    if (x && typeof x === 'object') {
      return Object.fromEntries(Object.keys(x as object).sort().map((k) => [k, sort((x as Record<string, unknown>)[k])]));
    }
    return x;
  };
  return JSON.stringify(sort(v));
}

/** A signature block from a record's YAML, or null when it has none or it is not one this version reads. */
export function parseSignature(raw: unknown): RecordSignature | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const s = raw as Record<string, unknown>;
  if (s.how === 'device' && typeof s.key === 'string' && FINGERPRINT.test(s.key)
    && typeof s.value === 'string' && /^[A-Za-z0-9+/]{86}==$/.test(s.value)) {
    return { how: 'device', key: s.key, value: s.value };
  }
  if (s.how === 'git' && typeof s.signer === 'string' && EMAIL.test(s.signer)
    && typeof s.value === 'string' && SSH_SIGNATURE.test(s.value.trim())) {
    return { how: 'git', signer: s.signer, value: s.value.trim() };
  }
  return null;
}

// ── The device key ───────────────────────────────────────────────────────

export interface DeviceKey {
  /** SPKI DER, base64: what a key file carries. */
  publicKey: string;
  /** PKCS#8 DER, base64. Kept in this device's database, never written to the project. */
  privateKey: string;
  fingerprint: string;
}

/** "SHA256:…" over the public key's bytes, as ssh-keygen writes a fingerprint. */
export function fingerprintOf(publicKey: string): string {
  return `SHA256:${crypto.createHash('sha256').update(Buffer.from(publicKey, 'base64')).digest('base64').replace(/=+$/, '')}`;
}

export function makeDeviceKey(): DeviceKey {
  const { publicKey, privateKey } = crypto.generateKeyPairSync('ed25519');
  const pub = publicKey.export({ type: 'spki', format: 'der' }).toString('base64');
  return { publicKey: pub, privateKey: privateKey.export({ type: 'pkcs8', format: 'der' }).toString('base64'), fingerprint: fingerprintOf(pub) };
}

export function signWithDevice(key: DeviceKey, bytes: string): RecordSignature {
  const priv = crypto.createPrivateKey({ key: Buffer.from(key.privateKey, 'base64'), format: 'der', type: 'pkcs8' });
  return { how: 'device', key: key.fingerprint, value: crypto.sign(null, Buffer.from(bytes, 'utf8'), priv).toString('base64') };
}

/** True when `value` is `publicKey`'s signature over `bytes`. Never throws. */
export function verifyWithDevice(publicKey: string, bytes: string, value: string): boolean {
  try {
    const pub = crypto.createPublicKey({ key: Buffer.from(publicKey, 'base64'), format: 'der', type: 'spki' });
    if (pub.asymmetricKeyType !== 'ed25519') return false;
    return crypto.verify(null, Buffer.from(bytes, 'utf8'), pub, Buffer.from(value, 'base64'));
  } catch { return false; }
}

// ── Introducing a device key: `.codetrellis/keys/<writer>.yaml` ─────────

export interface KeyIntroduction {
  writer: string;
  /** Who the device says it belongs to. A claim, shown beside the fingerprint for the person to check. */
  name: string;
  publicKey: string;
  fingerprint: string;
}

export function keyFileName(writer: string): string {
  return `${writer}.yaml`;
}

export function serializeKeyIntroduction(k: KeyIntroduction): string {
  return '# CodeTrellis: this device signs its task-state records with this key.\n'
    + '# Teammates trust it once, in Settings → Shared task state, after checking the\n'
    + '# fingerprint with its owner. Until then its records read "unverified".\n'
    + stringifyYaml({ kind: KEY_KIND, version: 1, writer: k.writer, name: k.name, publicKey: k.publicKey, fingerprint: k.fingerprint }, { lineWidth: 0 });
}

/**
 * A key introduction from a file, or why not. The fingerprint is computed,
 * never taken from the file, and the file must be named for its writer.
 */
export function parseKeyIntroduction(source: string, fileWriter: string): { key: KeyIntroduction } | { error: string } {
  if (Buffer.byteLength(source, 'utf8') > MAX_KEY_BYTES) return { error: 'larger than a key file can be' };
  let raw: unknown;
  try { raw = parseYaml(source, { maxAliasCount: 0 }); } catch { return { error: 'not YAML' }; }
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return { error: 'not a key file' };
  const r = raw as Record<string, unknown>;
  if (r.kind !== KEY_KIND || r.version !== 1) return { error: 'not a key file this version reads' };
  if (typeof r.writer !== 'string' || !WRITER.test(r.writer) || r.writer !== fileWriter) return { error: 'names another device than its file' };
  if (typeof r.publicKey !== 'string' || r.publicKey.length > 200) return { error: 'no public key' };
  try {
    const pub = crypto.createPublicKey({ key: Buffer.from(r.publicKey, 'base64'), format: 'der', type: 'spki' });
    if (pub.asymmetricKeyType !== 'ed25519') return { error: 'not an Ed25519 key' };
  } catch { return { error: 'not a public key' }; }
  const name = typeof r.name === 'string' && r.name.trim() ? r.name.trim().slice(0, 120) : 'someone';
  return { key: { writer: r.writer, name, publicKey: r.publicKey, fingerprint: fingerprintOf(r.publicKey) } };
}

/** The first characters of a fingerprint, as people compare them aloud. */
export function shortFingerprint(fp: string): string {
  return fp.slice(0, 7 + 12);
}
