import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import type { ArchitectureRule } from '../../shared/types/architecture-rules';
import {
  APPROVALS_DIR, RULE_CHANGE_NAMESPACE, approvalFor, approvalYaml, approvalsHere, deviceBytes, keysAt, parseApproval, ruleTerms, statementBytes,
  type RuleChangeStatement,
} from './rule-approvals';
import { makeDeviceKey, serializeKeyIntroduction, signWithDevice } from './task-records/signing';
import { changeWords, diffRules } from './rule-changes';

const rule = (extra: Partial<ArchitectureRule> = {}): ArchitectureRule => ({
  id: 'web-not-db', from: 'web/', mayNotImport: 'db/', except: [], because: 'through the API', since: '2026-10-06T00:00:00.000Z', by: 'Sam', strength: 'block', ...extra,
});
const ENV = { ...process.env, GIT_AUTHOR_NAME: 'Sam', GIT_AUTHOR_EMAIL: 'sam@acme.test', GIT_COMMITTER_NAME: 'Sam', GIT_COMMITTER_EMAIL: 'sam@acme.test' };
const git = (cwd: string, ...args: string[]) => execFileSync('git', ['-C', cwd, ...args], { encoding: 'utf8', env: ENV }).trim();
const put = (root: string, rel: string, text: string) => { fs.mkdirSync(path.dirname(path.join(root, rel)), { recursive: true }); fs.writeFileSync(path.join(root, rel), text); };
const commit = (root: string, msg: string) => { git(root, 'add', '-A'); git(root, 'commit', '-qm', msg); return git(root, 'rev-parse', 'HEAD'); };

function repo(): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ct-approvals-'));
  git(root, 'init', '-q', '-b', 'main');
  put(root, 'README.md', 'x\n');
  return root;
}

const device = makeDeviceKey();
const WRITER = 'abcdef0123456789';
const introduce = (root: string) => put(root, `.codetrellis/keys/${WRITER}.yaml`, serializeKeyIntroduction({ writer: WRITER, name: 'Sam', publicKey: device.publicKey, fingerprint: device.fingerprint }));

/** An approval of removing the rule, made by the device key at `base`. */
function deviceApproval(root: string, base: string, over: Partial<RuleChangeStatement> = {}): void {
  const s: RuleChangeStatement = { kind: 'codetrellis-rule-change', version: 1, rule: 'web-not-db', before: ruleTerms(rule()), after: null, base, signer: device.fingerprint, at: '2026-10-06T12:00:00.000Z', ...over };
  const sig = signWithDevice(device, deviceBytes(statementBytes(s)));
  put(root, `${APPROVALS_DIR}/web-not-db-${base.slice(0, 6)}.yaml`, approvalYaml(s, sig));
}

const removal = { rule: 'web-not-db', before: rule(), after: null };

test('a removal a person approved with a key the base lists verifies, and the gate says who', () => {
  const root = repo();
  introduce(root);
  const base = commit(root, 'base, with Sam\'s device key');
  deviceApproval(root, base);
  const keys = keysAt(root, base);
  try {
    const a = approvalFor(root, removal, approvalsHere(root), keys, base);
    assert.deepEqual(a, { ok: true, by: device.fingerprint, how: 'device', file: `${APPROVALS_DIR}/web-not-db-${base.slice(0, 6)}.yaml` });
    const [c] = diffRules([rule()], [], []);
    c.approval = a;
    assert.match(changeWords(c), /^✓ This change removes the rule “web\/ may not import db\/” \(web-not-db\)\. SHA256:.* approved it in the app, signed \(\.codetrellis\/rules\/approvals\/.*\)\.$/);
  } finally { keys.done(); }
});

test('a key the change itself introduces does not count: the base must list it', () => {
  const root = repo();
  const base = commit(root, 'base, no keys');
  introduce(root);
  deviceApproval(root, base);
  const keys = keysAt(root, base);
  try {
    const a = approvalFor(root, removal, approvalsHere(root), keys, base);
    assert.equal(a?.ok, false);
    assert.match((a as { why: string }).why, /signed with a device key the base branch does not list/);
  } finally { keys.done(); }
});

test('an approval made before the change\'s base approves an earlier change, not this one', () => {
  const root = repo();
  introduce(root);
  const old = commit(root, 'an old base');
  put(root, 'README.md', 'y\n');
  const base = commit(root, 'the base now');
  deviceApproval(root, old);
  const keys = keysAt(root, base);
  try {
    const a = approvalFor(root, removal, approvalsHere(root), keys, base);
    assert.equal(a?.ok, false);
    assert.match((a as { why: string }).why, /before this change's base/);
  } finally { keys.done(); }
});

test('an approval of some other change is no approval of this one; a tampered statement does not verify', () => {
  const root = repo();
  introduce(root);
  const base = commit(root, 'base');
  deviceApproval(root, base, { after: ruleTerms(rule({ strength: 'warn' })) });
  const keys = keysAt(root, base);
  try {
    assert.equal(approvalFor(root, removal, approvalsHere(root), keys, base), null);
    // Edit the signed statement in the file: what was signed is not what is read.
    const file = path.join(root, approvalsHere(root)[0].file);
    const text = fs.readFileSync(file, 'utf8');
    fs.writeFileSync(file, text.replace('"strength":"warn"', '"strength":"guide"'));
    const lower = { rule: 'web-not-db', before: rule(), after: rule({ strength: 'guide' }) };
    const a = approvalFor(root, lower, approvalsHere(root), keys, base);
    assert.equal(a?.ok, false);
    assert.match((a as { why: string }).why, /signature does not verify/);
  } finally { keys.done(); }
});

test('a file that is not an approval says why', () => {
  assert.deepEqual(parseApproval('kind: something-else\nversion: 1\nstatement: "{}"'), { error: 'not a rule-change approval this version reads' });
  assert.match((parseApproval('nope: [') as { error: string }).error, /not YAML/);
});

test('git\'s key: verified against the allowed signers file as the base has it, never the branch\'s copy', () => {
  const root = repo();
  const keyDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ct-sshkey-'));
  const key = path.join(keyDir, 'id');
  execFileSync('ssh-keygen', ['-q', '-t', 'ed25519', '-N', '', '-C', 'sam', '-f', key]);
  const pub = fs.readFileSync(`${key}.pub`, 'utf8').trim();
  git(root, 'config', 'gpg.ssh.allowedSignersFile', '.github/allowed_signers');
  put(root, '.github/allowed_signers', '# nobody yet\n');
  const base = commit(root, 'base: allowed signers, Sam not in it');
  const s: RuleChangeStatement = { kind: 'codetrellis-rule-change', version: 1, rule: 'web-not-db', before: ruleTerms(rule()), after: null, base, signer: 'sam@acme.test', at: '2026-10-06T12:00:00.000Z' };
  const value = execFileSync('ssh-keygen', ['-Y', 'sign', '-f', key, '-n', RULE_CHANGE_NAMESPACE], { input: statementBytes(s), encoding: 'utf8' }).trim();
  put(root, `${APPROVALS_DIR}/web-not-db-git.yaml`, approvalYaml(s, { how: 'git', signer: 'sam@acme.test', value }));
  // The branch adds Sam to the allowed signers in the same change.
  put(root, '.github/allowed_signers', `sam@acme.test namespaces="${RULE_CHANGE_NAMESPACE}" ${pub}\n`);
  let keys = keysAt(root, base);
  try {
    const a = approvalFor(root, removal, approvalsHere(root), keys, base);
    assert.equal(a?.ok, false);
  } finally { keys.done(); }

  // On a base that lists Sam, the same approval verifies.
  git(root, 'add', '.github/allowed_signers');
  const listed = commit(root, 'Sam is listed');
  const again: RuleChangeStatement = { ...s, base: listed };
  const v2 = execFileSync('ssh-keygen', ['-Y', 'sign', '-f', key, '-n', RULE_CHANGE_NAMESPACE], { input: statementBytes(again), encoding: 'utf8' }).trim();
  fs.rmSync(path.join(root, APPROVALS_DIR), { recursive: true });
  put(root, `${APPROVALS_DIR}/web-not-db-git.yaml`, approvalYaml(again, { how: 'git', signer: 'sam@acme.test', value: v2 }));
  keys = keysAt(root, listed);
  try {
    assert.deepEqual(approvalFor(root, removal, approvalsHere(root), keys, listed), { ok: true, by: 'sam@acme.test', how: 'git', file: `${APPROVALS_DIR}/web-not-db-git.yaml` });
  } finally { keys.done(); }
});
