/**
 * Phase 33 R3 — a person's approval of a loosening travels with the change
 * (design §4.3).
 *
 * When a person confirms a change in the app that loosens a rule (removes it,
 * lowers its strength, or changes its paths or exceptions in a way not proven
 * to only tighten, R2), it is signed and written beside the suites, as
 * `.codetrellis/rules/approvals/<rule>-<hash>.yaml`. The statement covers the
 * rule before and after (only what judges code: its paths, exceptions and
 * strength), and the commit the person's checkout was at.
 *
 * The signature is the person's, made the way their task records are (C3):
 * git's SSH key when git signing is set up with one, in its own namespace,
 * `codetrellis-rule-change`; else this device's own key, introduced to the
 * project under `.codetrellis/keys/`.
 *
 * CI accepts a loosening only with an approval that
 *  - matches it exactly: the same rule, the base's terms before, the
 *    branch's after;
 *  - was made on or after the merge base, so an old approval cannot be
 *    carried into a new change;
 *  - verifies against keys on the **base** branch: git's allowed signers as
 *    the base has them (when that file is in the repository), or a device
 *    key introduced on the base. A pull request cannot add a key and use it
 *    in the same change.
 * Anything else is no approval, and the check says why.
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { parse as parseYaml, stringify as stringifyYaml } from 'yaml';
import type { ArchitectureRule, RuleStrength } from '../../shared/types/architecture-rules';
import { RULE_STRENGTHS } from '../../shared/types/architecture-rules';
import { readTextWithin, writeFileWithin } from './confined-fs';
import { signingSetup, verifyRecord as verifySsh } from './signed-approvals';
import { canonicalJson, parseKeyIntroduction, parseSignature, signWithDevice, verifyWithDevice, type RecordSignature } from './task-records/signing';
import { deviceKey, introduceDeviceKey, KEYS_DIR } from './task-records/trust';

export const RULE_CHANGE_NAMESPACE = 'codetrellis-rule-change';
export const APPROVALS_DIR = '.codetrellis/rules/approvals';
const KIND = 'codetrellis-rule-change';
const MAX_APPROVALS = 200;
const MAX_BYTES = 16 * 1024;
const COMMIT = /^[0-9a-f]{40}$/;

/** What a rule holds a change to: the terms that judge code. Who set it, when and why are not signed. */
export interface RuleTerms {
  from: string; mayNotImport: string; except: string[]; strength: RuleStrength;
  /** A package rule's (R5); absent for an imports rule, so approvals signed before R5 still read the same. */
  kind?: 'package' | 'symbol' | 'calls' | 'folder' | 'grep' | 'agent'; only?: string[];
  /** B2: a grep rule's files, and whether its text is required, and in any case. */
  in?: string[]; must?: true; ignoreCase?: true;
  files?: string[]; kinds?: string[]; exports?: 'one';
  /** B1: absent for an exact target, so approvals signed before it still read the same. */
  match?: 'glob' | 'regex' | 'fuzzy';
  /** B3: a fuzzy target's threshold, absent for any other. */
  threshold?: number;
  /** What a pipeline stage selects it by; absent when it has none, so approvals signed before tags still read the same. */
  tags?: string[];
}

export function ruleTerms(r: ArchitectureRule | null | undefined): RuleTerms | null {
  if (!r) return null;
  const t = termsOf(r);
  return r.tags?.length ? { ...t, tags: [...r.tags].sort() } : t;
}

function termsOf(r: ArchitectureRule): RuleTerms {
  const terms: RuleTerms = { from: r.from, mayNotImport: r.mayNotImport, except: [...r.except].sort(), strength: r.strength };
  if (r.kind === 'folder') return { ...terms, kind: 'folder', files: [...(r.files ?? [])].sort(), kinds: [...(r.kinds ?? [])].sort(), ...(r.exports ? { exports: r.exports } : {}) };
  if (r.kind === 'agent') return { ...terms, kind: 'agent', in: [...(r.in ?? [])].sort() };
  if (r.kind === 'grep') return { ...terms, kind: 'grep', in: [...(r.in ?? [])].sort(), ...(r.must ? { must: true as const } : {}), ...(r.ignoreCase ? { ignoreCase: true as const } : {}), ...(r.match ? { match: r.match } : {}), ...(r.threshold !== undefined ? { threshold: r.threshold } : {}) };
  // B1: a matcher is part of what the rule means; absent, the terms are as they were signed before it.
  return r.kind === 'package' || r.kind === 'symbol' || r.kind === 'calls' ? { ...terms, kind: r.kind, only: [...(r.only ?? [])].sort(), ...(r.match ? { match: r.match } : {}), ...(r.threshold !== undefined ? { threshold: r.threshold } : {}) } : terms;
}

export interface RuleChangeStatement {
  kind: typeof KIND;
  version: 1;
  rule: string;
  before: RuleTerms | null;
  after: RuleTerms | null;
  /** The commit the person's checkout was at when they confirmed it, or null outside git. */
  base: string | null;
  /** git's user.email, or the device key's fingerprint. */
  signer: string;
  at: string;
}

/** The exact bytes signed. */
export const statementBytes = (s: RuleChangeStatement): string => canonicalJson(s);
/** A device key signs raw bytes; the namespace goes in front so the signature is good for nothing else. */
export const deviceBytes = (bytes: string): string => `${RULE_CHANGE_NAMESPACE}\n${bytes}`;

export function approvalYaml(s: RuleChangeStatement, signature: RecordSignature): string {
  return '# CodeTrellis: a person approved this change to an architecture rule, in the app.\n'
    + '# CI accepts the change only if this verifies against keys on the base branch.\n'
    + stringifyYaml({ kind: KIND, version: 1, statement: statementBytes(s), signature }, { lineWidth: 0 });
}

const isTerms = (v: unknown): v is RuleTerms => {
  if (!v || typeof v !== 'object') return false;
  const t = v as Record<string, unknown>;
  return typeof t.from === 'string' && typeof t.mayNotImport === 'string' && Array.isArray(t.except)
    && t.except.every((e) => typeof e === 'string') && RULE_STRENGTHS.includes(t.strength as RuleStrength);
};

export type ParsedApproval = { statement: RuleChangeStatement; bytes: string; signature: RecordSignature };

/** An approval file: anyone's text, so nothing beyond its shape is believed until it verifies. */
export function parseApproval(text: string): ParsedApproval | { error: string } {
  if (Buffer.byteLength(text, 'utf8') > MAX_BYTES) return { error: 'larger than an approval can be' };
  let raw: unknown;
  try { raw = parseYaml(text, { maxAliasCount: 0 }); } catch { return { error: 'not YAML' }; }
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return { error: 'not an approval' };
  const r = raw as Record<string, unknown>;
  if (r.kind !== KIND || r.version !== 1 || typeof r.statement !== 'string') return { error: 'not a rule-change approval this version reads' };
  const signature = parseSignature(r.signature);
  if (!signature) return { error: 'it has no signature this version reads' };
  let s: Record<string, unknown>;
  try { s = JSON.parse(r.statement) as Record<string, unknown>; } catch { return { error: 'its statement is not JSON' }; }
  if (s.kind !== KIND || s.version !== 1 || typeof s.rule !== 'string' || typeof s.signer !== 'string' || typeof s.at !== 'string'
    || !(s.before === null || isTerms(s.before)) || !(s.after === null || isTerms(s.after))
    || !(s.base === null || (typeof s.base === 'string' && COMMIT.test(s.base)))) {
    return { error: 'its statement is not a rule change' };
  }
  const statement = s as unknown as RuleChangeStatement;
  // The bytes in the file must be the canonical bytes, or what was signed is not what is read.
  if (statementBytes(statement) !== r.statement) return { error: 'its statement is not in canonical form' };
  return { statement, bytes: r.statement, signature };
}

function git(cwd: string, args: string[]): string | null {
  try {
    return execFileSync('git', ['-C', cwd, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], timeout: 15_000, maxBuffer: 4 * 1024 * 1024 });
  } catch { return null; }
}

// ── Signing, in the app ───────────────────────────────────────────────────

export interface Signed { file: string; how: 'git' | 'device'; as: string }

/**
 * Sign a person's confirmed change and write it beside the suites. The
 * caller decided it is a person's act (`mayGrant`); this only signs it.
 */
export function signRuleChange(
  projectRoot: string,
  change: { rule: string; before: ArchitectureRule | null; after: ArchitectureRule | null },
  device: { writer: string; name: string },
  now = Date.now(),
): Signed {
  const head = git(projectRoot, ['rev-parse', '--verify', '--quiet', 'HEAD^{commit}'])?.trim() ?? null;
  const base = head && COMMIT.test(head) ? head : null;
  const at = new Date(now).toISOString();
  const draft = (signer: string): RuleChangeStatement => ({
    kind: KIND, version: 1, rule: change.rule, before: ruleTerms(change.before), after: ruleTerms(change.after), base, signer, at,
  });

  let statement: RuleChangeStatement | null = null;
  let signature: RecordSignature | null = null;
  const setup = process.env.CODETRELLIS_GIT_SIGN_RECORDS === '0' ? null : signingSetup(projectRoot);
  if (setup?.canSign) {
    statement = draft(setup.signer!);
    try {
      const value = execFileSync('ssh-keygen', ['-Y', 'sign', '-f', setup.keyFile!, '-n', RULE_CHANGE_NAMESPACE], {
        input: statementBytes(statement), encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'], timeout: 15_000,
      });
      signature = { how: 'git', signer: setup.signer!, value: value.trim() };
    } catch (err) {
      console.warn('[Rules] git could not sign the approval; the device key signs it:', (err as Error).message.split('\n')[0]);
      statement = null;
    }
  }
  if (!statement || !signature) {
    const key = deviceKey();
    introduceDeviceKey(projectRoot, device.writer, device.name, key);
    statement = draft(key.fingerprint);
    signature = signWithDevice(key, deviceBytes(statementBytes(statement)));
  }
  const bytes = statementBytes(statement);
  const rel = `${APPROVALS_DIR}/${change.rule}-${createHash('sha256').update(bytes).digest('hex').slice(0, 12)}.yaml`;
  writeFileWithin(projectRoot, rel, approvalYaml(statement, signature), 'rule approval');
  return { file: rel, how: signature.how, as: statement.signer };
}

// ── Verifying, in CI ──────────────────────────────────────────────────────

/** The keys a commit trusts: device keys introduced on it, and git's allowed signers as it has them. */
export interface KeysAt {
  devices: Map<string, string>;
  allowedSigners: string | null;
  done(): void;
}

export function keysAt(projectRoot: string, commit: string): KeysAt {
  const devices = new Map<string, string>();
  const listing = git(projectRoot, ['ls-tree', '--name-only', commit, `./${KEYS_DIR}/`]);
  for (const line of (listing ?? '').split('\n').map((l) => l.trim()).filter(Boolean).slice(0, 500)) {
    const name = path.basename(line);
    const m = /^([a-f0-9]{8,32})\.yaml$/.exec(name);
    if (!m) continue;
    const text = git(projectRoot, ['show', `${commit}:./${KEYS_DIR}/${name}`]);
    if (!text) continue;
    const parsed = parseKeyIntroduction(text, m[1]);
    if ('key' in parsed) devices.set(parsed.key.fingerprint, parsed.key.publicKey);
  }

  // git's allowed signers: the base's copy when the file is in the repository,
  // so a change cannot list its own key; the machine's own file otherwise.
  let allowedSigners: string | null = null;
  let tmp: string | null = null;
  const configured = signingSetup(projectRoot).allowedSigners;
  if (configured) {
    const top = git(projectRoot, ['rev-parse', '--show-toplevel'])?.trim();
    const inRepo = top ? path.relative(fs.realpathSync(top), path.resolve(configured)) : null;
    if (inRepo !== null && !inRepo.startsWith('..') && !path.isAbsolute(inRepo)) {
      const text = git(top!, ['show', `${commit}:${inRepo.split(path.sep).join('/')}`]);
      if (text !== null) {
        tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'codetrellis-signers-'));
        allowedSigners = path.join(tmp, 'allowed_signers');
        fs.writeFileSync(allowedSigners, text, { mode: 0o600 });
      }
    } else if (fs.existsSync(configured)) {
      allowedSigners = configured;
    }
  }
  return { devices, allowedSigners, done: () => { if (tmp) fs.rmSync(tmp, { recursive: true, force: true }); } };
}

export interface ApprovalFile extends ParsedApproval { file: string }

/** The approvals in the working tree, each parsed; unreadable ones are left out. */
export function approvalsHere(projectRoot: string): ApprovalFile[] {
  const dir = path.join(projectRoot, APPROVALS_DIR);
  let names: string[];
  try {
    names = fs.readdirSync(dir, { withFileTypes: true }).filter((e) => e.isFile() && e.name.endsWith('.yaml')).map((e) => e.name).sort().slice(0, MAX_APPROVALS);
  } catch { return []; }
  const out: ApprovalFile[] = [];
  for (const name of names) {
    const file = `${APPROVALS_DIR}/${name}`;
    let text: string;
    try { text = readTextWithin(projectRoot, file, 'rule approval'); } catch { continue; }
    const p = parseApproval(text);
    if ('statement' in p) out.push({ ...p, file });
  }
  return out;
}

export type Approval = { ok: true; by: string; how: 'git' | 'device'; file: string } | { ok: false; why: string };

/**
 * Whether a loosening carries a person's approval: one of `approvals`
 * matching it, made on or after `mergeBase`, that verifies against the
 * base's keys. Null when none even claims to approve it.
 */
export function approvalFor(
  projectRoot: string,
  change: { rule: string; before: ArchitectureRule | null; after: ArchitectureRule | null },
  approvals: readonly ApprovalFile[],
  keys: KeysAt,
  mergeBase: string,
): Approval | null {
  const before = canonicalJson(ruleTerms(change.before));
  const after = canonicalJson(ruleTerms(change.after));
  const claims = approvals.filter((a) => a.statement.rule === change.rule && canonicalJson(a.statement.before) === before && canonicalJson(a.statement.after) === after);
  if (claims.length === 0) return null;
  let why = '';
  for (const a of claims) {
    const s = a.statement;
    if (!s.base) { why = `${a.file} was not made in a git checkout`; continue; }
    if (git(projectRoot, ['merge-base', '--is-ancestor', mergeBase, s.base]) === null) {
      why = `${a.file} was made at ${s.base.slice(0, 7)}, before this change's base (or that commit is not in this clone), so it approves an earlier change`;
      continue;
    }
    if (a.signature.how === 'device') {
      const pub = keys.devices.get(a.signature.key);
      if (!pub) { why = `${a.file} is signed with a device key the base branch does not list under ${KEYS_DIR}/`; continue; }
      if (a.signature.key !== s.signer || !verifyWithDevice(pub, deviceBytes(a.bytes), a.signature.value)) { why = `${a.file}'s signature does not verify`; continue; }
      return { ok: true, by: s.signer, how: 'device', file: a.file };
    }
    if (a.signature.signer !== s.signer) { why = `${a.file} names one signer in its statement and another on its signature`; continue; }
    const v = verifySsh(a.bytes, a.signature.value, s.signer, keys.allowedSigners, RULE_CHANGE_NAMESPACE);
    if (!v.ok) { why = `${a.file}: ${v.reason}`; continue; }
    return { ok: true, by: s.signer, how: 'git', file: a.file };
  }
  return { ok: false, why };
}
