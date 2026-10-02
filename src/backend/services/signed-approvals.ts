/**
 * Approvals as signed statements (Phase 32 C2.5b, shared-work doc C-2 §3).
 *
 * A person's approval of a criterion is kept in this machine's database, as
 * it always was. Where the plan is shared through a folder and git signing
 * is set up with an SSH key (`gpg.format ssh`, `user.signingkey`), it is also
 * written as a signed record, `<plan>/approvals/<uid>.yaml`: one file per
 * approval, only ever added, so two people never write the same file.
 *
 * On import each record is checked with `ssh-keygen -Y verify` against git's
 * `gpg.ssh.allowedSignersFile`, the list a team already keeps for signed
 * commits. A record that verifies, for a criterion whose wording has not
 * changed, adds that person's sign-off here (channel `file`). Anything else
 * is shown as "can't verify", with why, and counts for nothing: a plain edit
 * to a file can never make a person approve something.
 *
 * Signing and verifying are `ssh-keygen`'s, run with arguments and no shell;
 * the app holds no key and implements no signature scheme of its own.
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { getDb } from './database';
import { markDirty } from './persistence';
import { readTextWithin, writeFileWithin } from './confined-fs';
import { stampSelfWrite } from './self-write-tracker';
import {
  NAMESPACE, canonicalStatement, parseRecord, recordYaml, sha256, type ApprovalStatement,
} from './signed-approval-record';
import type { SignedApproval } from '../../shared/types';

const MAX_RECORDS = 500;
const SSH_KEYGEN = 'ssh-keygen';

function gitConfig(repo: string, key: string): string | null {
  try {
    const v = execFileSync('git', ['-C', repo, 'config', '--get', key], { encoding: 'utf-8', stdio: ['ignore', 'pipe', 'ignore'], timeout: 5000 }).trim();
    return v || null;
  } catch { return null; }
}

const expandHome = (p: string): string => (p.startsWith('~/') ? path.join(os.homedir(), p.slice(2)) : p);

export interface SigningSetup {
  /** True when an approval here can be signed. */
  canSign: boolean;
  /** Why not, in words, when it cannot. */
  why: string | null;
  signer: string | null;
  /** `-f` for ssh-keygen: a key file, or a public key written out for the agent to sign with. */
  keyFile: string | null;
  /** Git's allowed signers, for verifying. */
  allowedSigners: string | null;
}

/** What git says about signing in this repository. */
export function signingSetup(repo: string): SigningSetup {
  const signer = gitConfig(repo, 'user.email');
  const format = gitConfig(repo, 'gpg.format');
  const key = gitConfig(repo, 'user.signingkey');
  const allowed = gitConfig(repo, 'gpg.ssh.allowedSignersFile');
  const allowedSigners = allowed ? path.resolve(repo, expandHome(allowed)) : null;
  const no = (why: string): SigningSetup => ({ canSign: false, why, signer, keyFile: null, allowedSigners });
  if (format !== 'ssh') return no('git signing is not set up with an SSH key (gpg.format ssh)');
  if (!key) return no('git has no signing key (user.signingkey)');
  if (!signer) return no('git has no user.email to sign as');
  let keyFile: string;
  if (key.startsWith('key::')) {
    // A literal public key: ssh-agent holds the private half.
    // In a directory of its own: a fixed name in the shared temp folder is
    // one another local user could plant a link at.
    keyFile = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'codetrellis-signing-')), 'key.pub');
    fs.writeFileSync(keyFile, `${key.slice(5).trim()}\n`, { mode: 0o600, flag: 'wx' });
  } else {
    keyFile = path.resolve(repo, expandHome(key));
    if (!fs.existsSync(keyFile)) return no(`the signing key ${key} is not on this machine`);
  }
  return { canSign: true, why: null, signer, keyFile, allowedSigners };
}

function insertRow(r: SignedApproval & { file?: string | null }): void {
  getDb().run(
    `INSERT OR REPLACE INTO signed_approvals (uid, plan_uid, item_uid, criterion_uid, signer, origin, state, reason, file, at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [r.uid, r.planUid, r.itemUid, r.criterionUid, r.signer, r.origin, r.state, r.reason, r.file ?? null, r.at],
  );
  markDirty();
}

function rowToApproval(r: unknown[]): SignedApproval {
  return {
    uid: r[0] as string, planUid: r[1] as string, itemUid: r[2] as string, criterionUid: r[3] as string,
    signer: (r[4] as string | null) ?? null, origin: r[5] as SignedApproval['origin'], state: r[6] as SignedApproval['state'],
    reason: (r[7] as string | null) ?? null, at: r[8] as number,
  };
}

/** Every signed (or kept-local, or unverifiable) approval for an item's criteria, newest first. */
export function listSignedApprovals(itemUid: string): SignedApproval[] {
  const res = getDb().exec(
    `SELECT uid, plan_uid, item_uid, criterion_uid, signer, origin, state, reason, at FROM signed_approvals WHERE item_uid = ? ORDER BY at DESC`,
    [itemUid],
  );
  return (res[0]?.values ?? []).map(rowToApproval);
}

export interface SignInput {
  signoffUid: string;
  planUid: string;
  itemUid: string;
  criterionUid: string;
  criterionText: string;
  evidence: Record<string, string | null>;
  at: number;
  /** The project's root, and the plan's folder in it when the plan is shared through one. */
  repo: string | null;
  planDir: string | null;
}

/**
 * Sign a person's approval, where the plan is shared through a folder and
 * git signing is set up; otherwise record that it stays on this machine,
 * and why. Never throws: an approval stands whether or not it is signed.
 */
export function signApproval(input: SignInput): SignedApproval {
  const base = { uid: input.signoffUid, planUid: input.planUid, itemUid: input.itemUid, criterionUid: input.criterionUid, origin: 'here' as const, at: input.at };
  const local = (why: string, signer: string | null = null): SignedApproval => {
    const row: SignedApproval = { ...base, signer, state: 'local', reason: why };
    insertRow(row);
    return row;
  };
  if (!input.repo || !input.planDir) return local('the plan is not shared through a folder, so the approval stays on this machine');
  if (process.env.CODETRELLIS_SIGN_APPROVALS === '0') return local('signing approvals is turned off on this machine, so the approval stays on it');
  const setup = signingSetup(input.repo);
  if (!setup.canSign) return local(`${setup.why}, so the approval stays on this machine`, setup.signer);

  const statement: ApprovalStatement = {
    uid: input.signoffUid, planUid: input.planUid, itemUid: input.itemUid, criterionUid: input.criterionUid,
    criterionSha256: sha256(input.criterionText), decision: 'approved', evidence: input.evidence,
    signer: setup.signer!, at: new Date(input.at).toISOString(),
  };
  let signature: string;
  try {
    signature = execFileSync(SSH_KEYGEN, ['-Y', 'sign', '-f', setup.keyFile!, '-n', NAMESPACE], {
      input: canonicalStatement(statement), encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'], timeout: 15_000,
    });
  } catch (err) {
    const why = (err as { stderr?: string }).stderr?.toString().trim().split('\n').pop() || (err as Error).message;
    return local(`git's SSH key could not sign it (${why.slice(0, 160)}), so the approval stays on this machine`, setup.signer);
  }
  const rel = path.join('approvals', `${input.signoffUid}.yaml`);
  try {
    const written = writeFileWithin(input.planDir, rel, recordYaml(statement, signature), 'approval record');
    stampSelfWrite(written);
  } catch (err) {
    return local(`the record could not be written (${(err as Error).message}), so the approval stays on this machine`, setup.signer);
  }
  const row: SignedApproval = { ...base, signer: setup.signer, state: 'signed', reason: null };
  insertRow({ ...row, file: rel });
  return row;
}

export interface CriterionLookup {
  /** The criterion's wording and item, when it is one of this plan's. */
  criterion(criterionUid: string): { text: string; itemUid: string; planUid: string } | null;
  /** Add the verified person's sign-off; false when it is already here. */
  addSignoff(input: { uid: string; criterionUid: string; actor: string; evidence: Record<string, string | null>; at: number }): boolean;
}

/** Check one record's signature against git's allowed signers (an approval's namespace unless told another). */
export function verifyRecord(text: string, signature: string, signer: string, allowedSigners: string | null, namespace = NAMESPACE): { ok: true } | { ok: false; reason: string } {
  if (!allowedSigners) return { ok: false, reason: 'git has no allowed signers to check it against (gpg.ssh.allowedSignersFile)' };
  if (!fs.existsSync(allowedSigners)) return { ok: false, reason: `the allowed signers file ${allowedSigners} is not on this machine` };
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'codetrellis-verify-'));
  try {
    const sig = path.join(dir, 'approval.sig');
    fs.writeFileSync(sig, signature, { mode: 0o600 });
    execFileSync(SSH_KEYGEN, ['-Y', 'verify', '-f', allowedSigners, '-I', signer, '-n', namespace, '-s', sig], {
      input: text, stdio: ['pipe', 'pipe', 'pipe'], timeout: 15_000,
    });
    return { ok: true };
  } catch (err) {
    const e = err as { code?: string; stderr?: Buffer | string };
    if (e.code === 'ENOENT') return { ok: false, reason: 'ssh-keygen is not installed, so the signature cannot be checked' };
    const said = e.stderr?.toString().trim().split('\n').pop() ?? '';
    return { ok: false, reason: `the signature does not verify for ${signer}${said ? ` (${said.slice(0, 160)})` : ''}` };
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

/**
 * Read a plan folder's approval records. Each is checked; a verified one for
 * an unchanged criterion adds that person's sign-off, anything else is kept
 * as "can't verify" with why. A record already read is not read again.
 */
export function importApprovals(planDir: string, planUid: string, repo: string, lookup: CriterionLookup): { verified: number; unverified: number } {
  const dir = path.join(planDir, 'approvals');
  let names: string[];
  try {
    names = fs.readdirSync(dir, { withFileTypes: true }).filter((e) => e.isFile() && e.name.endsWith('.yaml')).map((e) => e.name).slice(0, MAX_RECORDS);
  } catch { return { verified: 0, unverified: 0 }; }
  // Verified here, or signed here: settled. One that could not be verified is
  // checked again, since the allowed signers may have been brought up to date.
  const known = new Set((getDb().exec(
    `SELECT uid FROM signed_approvals WHERE plan_uid = ? AND (origin = 'here' OR state = 'verified')`, [planUid],
  )[0]?.values ?? []).map((r) => r[0] as string));
  const allowed = signingSetup(repo).allowedSigners;
  let verified = 0;
  let unverified = 0;
  for (const name of names) {
    const rel = path.join('approvals', name);
    let content: string;
    try { content = readTextWithin(planDir, rel, 'approval record'); } catch { continue; }
    const parsed = parseRecord(content);
    const uidFromName = name.slice(0, -'.yaml'.length);
    if (known.has(uidFromName)) continue;
    const at = parsed.ok ? Date.parse(parsed.statement.at) : Date.now();
    const unverifiable = (reason: string, item: string, criterion: string, signer: string | null) => {
      insertRow({ uid: uidFromName, planUid, itemUid: item, criterionUid: criterion, signer, origin: 'file', state: 'unverified', reason, at, file: rel });
      unverified++;
    };
    if (!parsed.ok) { unverifiable(parsed.reason, '', '', null); continue; }
    const s = parsed.statement;
    if (s.uid !== uidFromName) { unverifiable('the file is named for another approval', s.itemUid, s.criterionUid, s.signer); continue; }
    if (s.planUid !== planUid) { unverifiable('the record is for another plan', s.itemUid, s.criterionUid, s.signer); continue; }
    const c = lookup.criterion(s.criterionUid);
    if (!c || c.itemUid !== s.itemUid || c.planUid !== planUid) { unverifiable('the criterion it approves is not in this plan', s.itemUid, s.criterionUid, s.signer); continue; }
    if (sha256(c.text) !== s.criterionSha256) { unverifiable('the criterion has been reworded since it was approved', s.itemUid, s.criterionUid, s.signer); continue; }
    const check = verifyRecord(parsed.text, parsed.signature, s.signer, allowed);
    if (!check.ok) { unverifiable(check.reason, s.itemUid, s.criterionUid, s.signer); continue; }
    lookup.addSignoff({ uid: s.uid, criterionUid: s.criterionUid, actor: s.signer, evidence: s.evidence, at });
    insertRow({ uid: s.uid, planUid, itemUid: s.itemUid, criterionUid: s.criterionUid, signer: s.signer, origin: 'file', state: 'verified', reason: null, at, file: rel });
    verified++;
  }
  return { verified, unverified };
}
