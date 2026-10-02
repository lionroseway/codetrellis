/**
 * The sign-off pack's seal (Phase 32 B10.3, observability doc §11).
 *
 * A pack leaves the app, so its file hashes alone prove only that the files
 * have not changed; nothing proved the pack itself had not. The seal is this
 * computer's Ed25519 key (the device key task records already use, C3.1)
 * over the whole pack, in its own namespace, with the record's head at the
 * moment of signing:
 *
 *   bytes = "codetrellis-signoff-pack\n" + canonical JSON of the pack
 *           (seal removed, JSON-normalised as a saved page reads it back)
 *
 * so a byte changed anywhere in the pack fails it, a task record's signature
 * can never pass for a pack's, and the pack pins the record: whatever the
 * record held at that entry, an edit made to it since shows here as well as
 * in the record's own walk.
 *
 * Who signed is said against what this computer trusts: its own key, a
 * teammate's key trusted in Settings (C3.1's introductions), or a key it
 * does not know, which verifies but proves nothing about who.
 */

import { getDb } from './database';
import { canonicalJson, fingerprintOf, shortFingerprint, signWithDevice, verifyWithDevice } from './task-records/signing';
import { deviceKey } from './task-records/trust';
import { recordHead } from './record-chain';

export const PACK_NAMESPACE = 'codetrellis-signoff-pack';

export interface PackSeal {
  how: 'device';
  /** The signing key's fingerprint, "SHA256:…". */
  key: string;
  /** The signing key's public half (SPKI DER, base64), so a pack verifies from the file alone. */
  publicKey: string;
  /** Ed25519 over `sealBytes(pack)`, base64. */
  value: string;
}

/** What a sealed pack carries besides its seal: the record's last entry when it was signed (inside the signed bytes). */
export interface SealedRecord { seq: number; hash: string }

export type SealState = 'this-computer' | 'teammate' | 'unknown-key' | 'changed' | 'unsigned';
export type SealRecordState = 'matches' | 'trimmed' | 'differs' | 'not-here';

export interface SealCheck {
  state: SealState;
  fingerprint: string | null;
  /** The teammate's name, when a trusted teammate's key signed it. */
  signer: string | null;
  record: { seq: number; hash: string; state: SealRecordState } | null;
  /** One sentence for a person. */
  words: string;
}

/** The bytes a seal signs: the pack without its seal, as a saved page reads it back. */
export function sealBytes(pack: Record<string, unknown>): string {
  const { seal: _seal, ...rest } = pack;
  return `${PACK_NAMESPACE}\n${canonicalJson(JSON.parse(JSON.stringify(rest)))}`;
}

/** The pack, sealed with this computer's key, carrying the record's head now (signed with the rest). */
export function sealPack<T extends object>(pack: T): T & { sealedRecord: SealedRecord; seal: PackSeal } {
  const key = deviceKey();
  const { seal: _old, ...rest } = pack as Record<string, unknown>;
  const body = { ...rest, sealedRecord: recordHead() } as T & { sealedRecord: SealedRecord };
  const value = signWithDevice(key, sealBytes(body as Record<string, unknown>)).value;
  return { ...body, seal: { how: 'device', key: key.fingerprint, publicKey: key.publicKey, value } };
}

function parseSeal(raw: unknown): PackSeal | null {
  if (!raw || typeof raw !== 'object') return null;
  const s = raw as Record<string, unknown>;
  if (s.how !== 'device' || typeof s.key !== 'string' || typeof s.publicKey !== 'string' || typeof s.value !== 'string') return null;
  if (s.publicKey.length > 200 || s.value.length > 200) return null;
  return { how: 'device', key: s.key, publicKey: s.publicKey, value: s.value };
}

function parseRecord(raw: unknown): SealedRecord | null {
  const r = raw as { seq?: unknown; hash?: unknown } | null | undefined;
  return r && Number.isInteger(r.seq) && (r.seq as number) >= 0 && typeof r.hash === 'string' && /^[0-9a-f]{64}$/.test(r.hash)
    ? { seq: r.seq as number, hash: r.hash } : null;
}

/** Whether this computer's record still has the entry a pack it signed names. */
function recordState(seq: number, hash: string): SealRecordState {
  const db = getDb();
  const link = db.exec('SELECT hash FROM record_chain WHERE seq = ?', [seq])[0]?.values[0];
  if (link) return String(link[0]) === hash ? 'matches' : 'differs';
  const anchor = db.exec('SELECT through_seq, hash FROM record_anchor WHERE id = 1')[0]?.values[0];
  if (anchor && Number(anchor[0]) === seq) return String(anchor[1]) === hash ? 'matches' : 'differs';
  if (anchor && Number(anchor[0]) > seq) return 'trimmed';
  // The record never reached that entry (seq 0: signed before anything was kept).
  return seq === 0 ? 'matches' : 'differs';
}

const RECORD_WORDS: Record<SealRecordState, string> = {
  matches: 'the record it names is still here and unchanged',
  trimmed: 'the record it names has since been removed by retention',
  differs: 'but the record it names has changed since',
  'not-here': 'the record it names is on that computer',
};

/** Who sealed a pack, whether it changed since, and whether the record it names still holds. Never throws. */
export function checkSeal(pack: unknown): SealCheck {
  const p = (pack && typeof pack === 'object' ? pack : {}) as Record<string, unknown>;
  const seal = parseSeal(p.seal);
  if (!seal) {
    return { state: 'unsigned', fingerprint: null, signer: null, record: null, words: 'This pack is not signed: it was made before packs were signed, or its signature was removed.' };
  }
  const short = `${shortFingerprint(seal.key)}…`;
  const record = parseRecord(p.sealedRecord);
  const intact = record !== null && fingerprintOf(seal.publicKey) === seal.key
    && verifyWithDevice(seal.publicKey, sealBytes(p), seal.value);
  if (!intact) {
    return { state: 'changed', fingerprint: seal.key, signer: null, record: null, words: `Changed after it was signed: this pack no longer matches its signature (key ${short}).` };
  }
  const mine = deviceKey().fingerprint === seal.key;
  if (mine) {
    const state = recordState(record!.seq, record!.hash);
    return {
      state: 'this-computer', fingerprint: seal.key, signer: null,
      record: { ...record!, state },
      words: `Signed by this computer (${short}), and unchanged since; ${RECORD_WORDS[state]} (entry #${record!.seq}).`,
    };
  }
  const teammate = getDb().exec("SELECT name FROM task_record_keys WHERE fingerprint = ? AND state = 'trusted' LIMIT 1", [seal.key])[0]?.values[0];
  if (teammate) {
    return {
      state: 'teammate', fingerprint: seal.key, signer: String(teammate[0]),
      record: { ...record!, state: 'not-here' },
      words: `Signed by ${String(teammate[0])}'s computer (${short}), a key you trust, and unchanged since; ${RECORD_WORDS['not-here']} (entry #${record!.seq}).`,
    };
  }
  return {
    state: 'unknown-key', fingerprint: seal.key, signer: null,
    record: { ...record!, state: 'not-here' },
    words: `Signed by a key this computer does not know (${short}): unchanged since it was signed, but who signed it is not proven. Check the fingerprint with whoever sent it.`,
  };
}
