/**
 * Phase 33 C9 — a signed review on the pull request: verified against the
 * keys on the base, refused when forged or signed by a key the base does not
 * list, stale after a push. Real git, a real Ed25519 key, no app.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { makeDeviceKey, serializeKeyIntroduction, signWithDevice } from './task-records/signing';
import { attestationYaml, NOTES_REF, parseNote, signedBytes, statementBytes, verifyReview, type ReviewStatement } from './review-notes';

const ENV = { ...process.env, GIT_AUTHOR_NAME: 'Sam', GIT_AUTHOR_EMAIL: 'sam@x.test', GIT_COMMITTER_NAME: 'Sam', GIT_COMMITTER_EMAIL: 'sam@x.test' };
const WRITER = 'a1b2c3d4e5f60718';

function repo() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ct-notes-'));
  const git = (...args: string[]) => execFileSync('git', ['-C', root, ...args], { encoding: 'utf8', env: ENV, stdio: ['pipe', 'pipe', 'pipe'] }).trim();
  const gitIn = (input: string, ...args: string[]) => execFileSync('git', ['-C', root, ...args], { encoding: 'utf8', env: ENV, input }).trim();
  git('init', '-q', '-b', 'main');
  fs.writeFileSync(path.join(root, 'a.ts'), 'export const a = 1;\n');
  git('add', '-A');
  git('commit', '-qm', 'first');
  return { root, git, gitIn };
}

const statement = (head: string, signer: string, says = 'The API client calls Stripe directly.'): ReviewStatement => ({
  kind: 'codetrellis-review', version: 1, head, base: null, agent: 'cursor', outcome: 'findings', reason: null, scope: 'every rule',
  findings: [{ kind: 'rule', path: 'a.ts', start: 1, end: 1, quote: 'export const a', says, rule: 'stripe-via-client', fix: null }],
  dropped: 0, signer, at: '2026-10-08T00:00:00.000Z',
});

test('a review signed on a device the base lists is verified on the commit it reviewed', () => {
  const { root, git, gitIn } = repo();
  const key = makeDeviceKey();
  fs.mkdirSync(path.join(root, '.codetrellis', 'keys'), { recursive: true });
  fs.writeFileSync(path.join(root, '.codetrellis', 'keys', `${WRITER}.yaml`), serializeKeyIntroduction({ writer: WRITER, name: 'Sam', publicKey: key.publicKey, fingerprint: key.fingerprint }));
  git('add', '-A');
  git('commit', '-qm', 'Sam\'s key');
  const base = git('rev-parse', 'HEAD');
  git('checkout', '-qb', 'work');
  fs.writeFileSync(path.join(root, 'a.ts'), 'export const a = 2;\n');
  git('commit', '-qam', 'change');
  const head = git('rev-parse', 'HEAD');

  assert.equal(verifyReview(root, head, base).state, 'none');
  const s = statement(head, key.fingerprint);
  gitIn(attestationYaml(s, signWithDevice(key, signedBytes(statementBytes(s)))), 'notes', `--ref=${NOTES_REF}`, 'append', '-F', '-', head);
  const v = verifyReview(root, head, base);
  assert.equal(v.state, 'verified');
  assert.equal(v.review?.agent, 'cursor');
  assert.match(v.words, /^✓ cursor's review of [0-9a-f]{7}, signed on a device the base trusts \(SHA256:[A-Za-z0-9+/]{12}\): 1 finding\.$/);

  // Forged: the words changed after signing.
  const note = git('notes', `--ref=${NOTES_REF}`, 'show', head);
  const tampered = note.replace('calls Stripe directly', 'is fine');
  assert.notEqual(tampered, note);
  gitIn(tampered, 'notes', `--ref=${NOTES_REF}`, 'add', '-f', '-F', '-', head);
  const refused = verifyReview(root, head, base);
  assert.equal(refused.state, 'refused');
  assert.match(refused.words, /cursor's, because its signature does not verify/);

  // Signed by a key the base does not list.
  const stranger = makeDeviceKey();
  const t = statement(head, stranger.fingerprint);
  gitIn(attestationYaml(t, signWithDevice(stranger, signedBytes(statementBytes(t)))), 'notes', `--ref=${NOTES_REF}`, 'add', '-f', '-F', '-', head);
  assert.match(verifyReview(root, head, base).words, /is not one the base branch lists under \.codetrellis\/keys\//);

  // A review copied onto another commit is not of it.
  const u = statement(base, key.fingerprint);
  gitIn(attestationYaml(u, signWithDevice(key, signedBytes(statementBytes(u)))), 'notes', `--ref=${NOTES_REF}`, 'add', '-f', '-F', '-', head);
  assert.match(verifyReview(root, head, base).words, /it is signed as a review of [0-9a-f]{7}, not of the commit it is on/);

  // A push after a good review makes it stale.
  gitIn(attestationYaml(s, signWithDevice(key, signedBytes(statementBytes(s)))), 'notes', `--ref=${NOTES_REF}`, 'add', '-f', '-F', '-', head);
  fs.writeFileSync(path.join(root, 'a.ts'), 'export const a = 3;\n');
  git('commit', '-qam', 'after the review');
  const later = git('rev-parse', 'HEAD');
  const stale = verifyReview(root, later, base);
  assert.equal(stale.state, 'stale');
  assert.equal(stale.words, `⚠ The latest review is cursor's of ${head.slice(0, 7)}, before the last push: it does not count for ${later.slice(0, 7)}. Review the head again.`);
});

test('a note holds every review of the commit; what cannot be read is counted, not believed', () => {
  const key = makeDeviceKey();
  const s = statement('0'.repeat(40), key.fingerprint);
  const one = attestationYaml(s, signWithDevice(key, signedBytes(statementBytes(s))));
  const { attestations, unreadable } = parseNote(`${one}\n${one}\n---\nkind: something-else\n`);
  assert.equal(attestations.length, 2);
  assert.equal(unreadable, 1);
});
