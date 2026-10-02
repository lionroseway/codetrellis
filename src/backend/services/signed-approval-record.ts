/**
 * An approval as a signed statement — the record's format (Phase 32 C2.5b,
 * shared-work doc C-2 §3). Pure.
 *
 * The statement is canonical JSON (keys sorted, no spaces), so the bytes
 * that were signed are the bytes in the file and can be checked again on any
 * machine. The record is YAML holding the statement as a string and the SSH
 * signature over it (`ssh-keygen -Y sign`, namespace NAMESPACE). Nothing in
 * the record is trusted until the signature verifies against the signer's
 * key in git's allowed signers; until then it is only what the file says.
 */

import { createHash } from 'node:crypto';
import { parse as parseYaml, stringify as stringifyYaml } from 'yaml';

export const NAMESPACE = 'codetrellis-approval';
export const RECORD_KIND = 'codetrellis-approval';
const MAX_RECORD_BYTES = 16 * 1024;
const UID = /^[A-Za-z0-9-]{8,64}$/;
const EMAIL = /^[^\s<>@]{1,64}@[^\s<>@]{1,255}$/;
const SHA256 = /^[0-9a-f]{64}$/;

/** What a person approved, and when. Every field is signed. */
export interface ApprovalStatement {
  uid: string;
  planUid: string;
  itemUid: string;
  criterionUid: string;
  /** sha256 of the criterion's wording when it was approved: a reworded criterion is not the one approved. */
  criterionSha256: string;
  decision: 'approved';
  /** sha256 of each file the approval was taken on, by attachment uid; null for one that could not be read. */
  evidence: Record<string, string | null>;
  /** The approver, as git knows them (`user.email`): the principal checked in allowed signers. */
  signer: string;
  at: string;
}

export const sha256 = (text: string): string => createHash('sha256').update(text, 'utf-8').digest('hex');

/** The exact bytes signed: canonical JSON, keys sorted at every level. */
export function canonicalStatement(s: ApprovalStatement): string {
  const sort = (v: unknown): unknown => {
    if (Array.isArray(v)) return v.map(sort);
    if (v && typeof v === 'object') {
      return Object.fromEntries(Object.keys(v as object).sort().map((k) => [k, sort((v as Record<string, unknown>)[k])]));
    }
    return v;
  };
  return JSON.stringify(sort(s));
}

/** The file written to `<plan>/approvals/<uid>.yaml`. */
export function recordYaml(statement: ApprovalStatement, signature: string): string {
  return stringifyYaml({ kind: RECORD_KIND, version: 1, statement: canonicalStatement(statement), signature: signature.trim() });
}

export type ParsedRecord =
  | { ok: true; statement: ApprovalStatement; text: string; signature: string }
  | { ok: false; reason: string };

/**
 * Read a record from a file: anyone's text, so everything is checked and
 * nothing beyond its shape is believed. `text` is the statement exactly as
 * it was signed.
 */
export function parseRecord(content: string): ParsedRecord {
  if (Buffer.byteLength(content, 'utf-8') > MAX_RECORD_BYTES) return { ok: false, reason: 'the record is too large' };
  let doc: unknown;
  try { doc = parseYaml(content); } catch { return { ok: false, reason: 'the record is not readable YAML' }; }
  if (!doc || typeof doc !== 'object') return { ok: false, reason: 'the record is empty' };
  const d = doc as Record<string, unknown>;
  if (d.kind !== RECORD_KIND || d.version !== 1) return { ok: false, reason: 'not an approval record this version reads' };
  if (typeof d.statement !== 'string' || typeof d.signature !== 'string') return { ok: false, reason: 'the record has no statement or no signature' };
  if (!/^-----BEGIN SSH SIGNATURE-----\n[A-Za-z0-9+/=\n]+-----END SSH SIGNATURE-----\s*$/.test(d.signature.trim() + '\n')) {
    return { ok: false, reason: 'the signature is not an SSH signature' };
  }
  let s: Record<string, unknown>;
  try { s = JSON.parse(d.statement) as Record<string, unknown>; } catch { return { ok: false, reason: 'the statement is not JSON' }; }
  const evidence = s.evidence;
  const ok = s && typeof s === 'object'
    && typeof s.uid === 'string' && UID.test(s.uid)
    && typeof s.planUid === 'string' && UID.test(s.planUid)
    && typeof s.itemUid === 'string' && UID.test(s.itemUid)
    && typeof s.criterionUid === 'string' && UID.test(s.criterionUid)
    && typeof s.criterionSha256 === 'string' && SHA256.test(s.criterionSha256)
    && s.decision === 'approved'
    && typeof s.signer === 'string' && EMAIL.test(s.signer)
    && typeof s.at === 'string' && !Number.isNaN(Date.parse(s.at))
    && !!evidence && typeof evidence === 'object' && !Array.isArray(evidence)
    && Object.entries(evidence as object).every(([k, v]) => UID.test(k) && (v === null || (typeof v === 'string' && SHA256.test(v))));
  if (!ok) return { ok: false, reason: 'the statement is missing a field or has one it should not' };
  const statement = s as unknown as ApprovalStatement;
  // The bytes signed must be the canonical form: no second spelling of the same claim.
  if (canonicalStatement(statement) !== d.statement) return { ok: false, reason: 'the statement is not in its signed form' };
  return { ok: true, statement, text: d.statement, signature: d.signature.trim() + '\n' };
}
