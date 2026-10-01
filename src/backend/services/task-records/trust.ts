/**
 * Whose record is it: signing this machine's records and checking
 * teammates' (Phase 32 C3.3). The scheme is in `signing.ts`; this file holds
 * the keys and the decisions.
 *
 *  - **Signing.** With git's SSH key when git signing is set up with one
 *    (C2.5b's `signingSetup`), else with this device's own key, made once and
 *    kept in this device's database. A device key is introduced to the
 *    project once, as `.codetrellis/keys/<writer>.yaml`.
 *  - **Introductions are not trust.** A key file anyone could have written is
 *    kept as "new" until the person trusts it, in the app window (the grant
 *    rule), having compared its fingerprint with its owner. Trust is per
 *    device key, not per project: a teammate is introduced once.
 *  - **Checking.** A record verifies when its signature is good for a key
 *    trusted for the device that wrote it, or for git's key of the signer
 *    git's allowed signers lists. Anything else is unverified, with why.
 */

import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { getDb } from '../database';
import { markDirty } from '../persistence';
import { readTextWithin, writeFileWithin } from '../confined-fs';
import { signingSetup, verifyRecord as verifySsh } from '../signed-approvals';
import {
  RECORD_NAMESPACE, keyFileName, makeDeviceKey, parseKeyIntroduction, serializeKeyIntroduction, shortFingerprint,
  signWithDevice, verifyWithDevice, type DeviceKey, type RecordSignature,
} from './signing';
import type { SignedPart, TaskRecord } from './record';
import { isPlaceholder } from '../cloud-files';

export const KEYS_DIR = path.join('.codetrellis', 'keys');
const MAX_KEY_FILES = 500;

// ── This device's key ────────────────────────────────────────────────────

export function deviceKey(): DeviceKey {
  const v = getDb().exec('SELECT public_key, private_key, fingerprint FROM task_record_device_key WHERE id = 1')[0]?.values[0];
  if (v) return { publicKey: String(v[0]), privateKey: String(v[1]), fingerprint: String(v[2]) };
  const k = makeDeviceKey();
  getDb().run(
    'INSERT OR IGNORE INTO task_record_device_key (id, public_key, private_key, fingerprint, created_at) VALUES (1, ?, ?, ?, ?)',
    [k.publicKey, k.privateKey, k.fingerprint, Date.now()],
  );
  markDirty();
  return deviceKey();
}

/** How this machine signs records in a project, in words, and with what. */
export interface SigningWay {
  how: 'git' | 'device';
  /** git's user.email, or the device key's fingerprint. */
  as: string;
  says: string;
}

const gitSigningAllowed = () => process.env.CODETRELLIS_GIT_SIGN_RECORDS !== '0';

export function signingWay(projectRoot: string): SigningWay {
  const setup = gitSigningAllowed() ? signingSetup(projectRoot) : null;
  if (setup?.canSign) {
    return { how: 'git', as: setup.signer!, says: `Records written here are signed with your git SSH key, as ${setup.signer}. Teammates check them against git's allowed signers, as they do signed commits.` };
  }
  const k = deviceKey();
  return {
    how: 'device', as: k.fingerprint,
    says: `Records written here are signed with this device's own key (${shortFingerprint(k.fingerprint)}…). Teammates trust it once, in their Settings, after checking that fingerprint with you.`,
  };
}

/**
 * Sign a record this machine is about to write, for a project whose records
 * go under `home`. git's key (the project's git config) first; when it
 * cannot sign (no agent, a passphrase prompt that times out), the device's,
 * whose introduction is written to the project if it is not there yet.
 */
export function signRecord(projectRoot: string, home: string, record: Pick<TaskRecord, 'writer' | 'name'>, bytes: string): RecordSignature {
  const setup = gitSigningAllowed() ? signingSetup(projectRoot) : null;
  if (setup?.canSign) {
    try {
      const value = execFileSync('ssh-keygen', ['-Y', 'sign', '-f', setup.keyFile!, '-n', RECORD_NAMESPACE], {
        input: bytes, encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'], timeout: 15_000,
      });
      return { how: 'git', signer: setup.signer!, value: value.trim() };
    } catch (err) {
      console.warn('[TaskRecords] git could not sign a record; the device key signs it:', (err as Error).message.split('\n')[0]);
    }
  }
  const key = deviceKey();
  // Introduced where the records go: the project, or its linked plans folder (C3.4a).
  introduceDeviceKey(home, record.writer, record.name, key);
  return signWithDevice(key, bytes);
}

/** Write this device's key introduction to the project, unless it is there and the same. */
export function introduceDeviceKey(projectRoot: string, writer: string, name: string, key: DeviceKey): void {
  const rel = path.join(KEYS_DIR, keyFileName(writer));
  const text = serializeKeyIntroduction({ writer, name, publicKey: key.publicKey, fingerprint: key.fingerprint });
  try {
    if (readTextWithin(projectRoot, rel, 'device key') === text) return;
  } catch { /* not there yet */ }
  writeFileWithin(projectRoot, rel, text, 'device key');
}

// ── Teammates' keys ──────────────────────────────────────────────────────

export type KeyState = 'new' | 'trusted' | 'refused';

export interface TeammateKey {
  writer: string;
  name: string;
  fingerprint: string;
  /** The fingerprint's first characters, as people compare them. */
  short: string;
  state: KeyState;
  firstSeen: number;
  decidedAt: number | null;
  decidedBy: string | null;
  /** True when this device already trusts another key for the same device: it changed key. */
  replaces: boolean;
}

/**
 * Read a project's key introductions. A key not seen before is kept as new;
 * one already known is left as the person decided. This device's own file is
 * skipped. Returns how many were new.
 */
export function readKeyIntroductions(projectRoot: string, me: string): number {
  const dir = path.join(projectRoot, KEYS_DIR);
  let names: string[];
  try {
    names = fs.readdirSync(dir, { withFileTypes: true })
      .filter((e) => e.isFile() && /^[a-f0-9]{8,32}\.yaml$/.test(e.name))
      .map((e) => e.name).slice(0, MAX_KEY_FILES);
  } catch { return 0; }
  let added = 0;
  for (const name of names) {
    const writer = name.slice(0, -'.yaml'.length);
    if (writer === me) continue;
    if (isPlaceholder(path.join(dir, name))) continue; // still in the cloud (C3.4b)
    let text: string;
    try { text = readTextWithin(projectRoot, path.join(KEYS_DIR, name), 'device key'); } catch { continue; }
    const parsed = parseKeyIntroduction(text, writer);
    if (!('key' in parsed)) continue;
    const k = parsed.key;
    if (getDb().exec('SELECT 1 FROM task_record_keys WHERE writer = ? AND fingerprint = ?', [k.writer, k.fingerprint])[0]?.values[0]) continue;
    getDb().run(
      `INSERT INTO task_record_keys (writer, fingerprint, public_key, name, project_root, state, first_seen) VALUES (?, ?, ?, ?, ?, 'new', ?)`,
      [k.writer, k.fingerprint, k.publicKey, k.name, projectRoot, Date.now()],
    );
    added++;
  }
  if (added) markDirty();
  return added;
}

function rowToKey(v: unknown[], trustedWriters: Set<string>): TeammateKey {
  const writer = String(v[0]);
  const state = String(v[3]) as KeyState;
  return {
    writer, name: String(v[1]), fingerprint: String(v[2]), short: shortFingerprint(String(v[2])), state,
    firstSeen: Number(v[4]), decidedAt: v[5] == null ? null : Number(v[5]), decidedBy: v[6] == null ? null : String(v[6]),
    replaces: state !== 'trusted' && trustedWriters.has(writer),
  };
}

/** Every teammate key introduced in this project: new ones first, then by name. */
export function listTeammateKeys(projectRoot: string): TeammateKey[] {
  const rows = getDb().exec(
    `SELECT writer, name, fingerprint, state, first_seen, decided_at, decided_by FROM task_record_keys
     WHERE project_root = ? OR writer IN (SELECT writer FROM task_record_keys WHERE project_root = ?)
     ORDER BY CASE state WHEN 'new' THEN 0 WHEN 'trusted' THEN 1 ELSE 2 END, name, writer`,
    [projectRoot, projectRoot],
  )[0]?.values ?? [];
  const trusted = new Set(rows.filter((r) => r[3] === 'trusted').map((r) => String(r[0])));
  return rows.map((r) => rowToKey(r, trusted));
}

/** Trust or refuse a teammate's device key. The caller has checked that the person asked. */
export function decideKey(writer: string, fingerprint: string, trust: boolean, by: string): TeammateKey | null {
  const known = getDb().exec('SELECT 1 FROM task_record_keys WHERE writer = ? AND fingerprint = ?', [writer, fingerprint])[0]?.values[0];
  if (!known) return null;
  getDb().run(
    'UPDATE task_record_keys SET state = ?, decided_at = ?, decided_by = ? WHERE writer = ? AND fingerprint = ?',
    [trust ? 'trusted' : 'refused', Date.now(), by, writer, fingerprint],
  );
  markDirty();
  verdicts.clear();
  const rows = getDb().exec(
    'SELECT writer, name, fingerprint, state, first_seen, decided_at, decided_by FROM task_record_keys WHERE writer = ?', [writer],
  )[0]?.values ?? [];
  const trusted = new Set(rows.filter((r) => r[3] === 'trusted').map((r) => String(r[0])));
  const row = rows.find((r) => r[2] === fingerprint);
  return row ? rowToKey(row, trusted) : null;
}

// ── Checking a record ────────────────────────────────────────────────────

export type Verdict =
  | { verified: true; how: 'git' | 'device'; who: string }
  | { verified: false; why: string };

/** What a check needs that does not change from one record to the next. */
export interface CheckContext { allowedSigners: string | null; allowedStamp: string }

export function checkContext(projectRoot: string): CheckContext {
  const allowed = signingSetup(projectRoot).allowedSigners;
  let stamp = 'none';
  if (allowed) {
    try { const s = fs.statSync(allowed); stamp = `${s.mtimeMs}:${s.size}`; } catch { stamp = 'missing'; }
  }
  return { allowedSigners: allowed, allowedStamp: stamp };
}

/** Checked once per record content: a record never changes, and ssh-keygen is a process. Cleared when trust changes. */
const verdicts = new Map<string, Verdict>();
const MAX_VERDICTS = 20_000;

export function verifyTaskRecord(record: Pick<TaskRecord, 'writer'>, signed: SignedPart, ctx: CheckContext): Verdict {
  const sig = signed.signature;
  if (!sig) return { verified: false, why: 'it is not signed' };
  const key = crypto.createHash('sha256').update(`${record.writer}\n${signed.bytes}\n${JSON.stringify(sig)}\n${ctx.allowedStamp}`).digest('hex');
  const cached = verdicts.get(key);
  if (cached) return cached;
  const verdict = check(record, signed.bytes, sig, ctx);
  if (verdicts.size >= MAX_VERDICTS) verdicts.clear();
  verdicts.set(key, verdict);
  return verdict;
}

function check(record: Pick<TaskRecord, 'writer'>, bytes: string, sig: RecordSignature, ctx: CheckContext): Verdict {
  if (sig.how === 'git') {
    const out = verifySsh(bytes, sig.value, sig.signer, ctx.allowedSigners, RECORD_NAMESPACE);
    return out.ok ? { verified: true, how: 'git', who: sig.signer } : { verified: false, why: out.reason };
  }
  const v = getDb().exec(
    'SELECT public_key, name, state FROM task_record_keys WHERE writer = ? AND fingerprint = ?', [record.writer, sig.key],
  )[0]?.values[0];
  if (!v) return { verified: false, why: `it is signed with a device key (${shortFingerprint(sig.key)}…) this project has not introduced` };
  const [publicKey, name, state] = [String(v[0]), String(v[1]), String(v[2])];
  if (state === 'refused') return { verified: false, why: `it is signed with ${name}'s device key, which you refused` };
  if (state !== 'trusted') return { verified: false, why: `it is signed with ${name}'s device key, which you have not trusted yet` };
  if (!verifyWithDevice(publicKey, bytes, sig.value)) return { verified: false, why: `its signature does not match ${name}'s device key: it was changed after it was signed` };
  return { verified: true, how: 'device', who: name };
}

/** For tests: forget every cached check. */
export function forgetVerdicts(): void {
  verdicts.clear();
}
