/**
 * Phase 32 C2.2a — secrets are kept encrypted by the OS keychain, or in
 * memory only; never as plain text on disk.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileStore, memoryStore, openSecretStore } from './secret-store';

// Stands in for Electron's safeStorage: reversible, and not the plain text.
const cipher = {
  encrypt: (s: string) => Buffer.from([...Buffer.from(s)].map((b) => b ^ 0x5a)),
  decrypt: (b: Buffer) => Buffer.from([...b].map((x) => x ^ 0x5a)).toString(),
};

test('under plain Node there is no keychain: a secret lasts until the app quits, and the store says why', () => {
  const s = openSecretStore();
  assert.equal(s.kind, 'memory');
  assert.match(s.where, /^kept only until CodeTrellis quits: /);
  s.set('review-host:github.com', 'ghp_abc');
  assert.equal(s.get('review-host:github.com'), 'ghp_abc');
  s.delete('review-host:github.com');
  assert.equal(s.has('review-host:github.com'), false);
});

test('with a keychain: only ciphertext reaches the disk, in a file whose name says nothing, readable only by the owner', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ct-secrets-'));
  const s = fileStore(path.join(dir, 'secrets'), cipher, 'encrypted');
  s.set('review-host:github.com', 'ghp_token_value');
  const files = fs.readdirSync(path.join(dir, 'secrets'));
  assert.equal(files.length, 1);
  assert.match(files[0], /^[0-9a-f]{32}\.bin$/);
  const raw = fs.readFileSync(path.join(dir, 'secrets', files[0]));
  assert.ok(!raw.toString('latin1').includes('ghp_token_value'));
  if (process.platform !== 'win32') assert.equal(fs.statSync(path.join(dir, 'secrets', files[0])).mode & 0o777, 0o600);
  // A fresh store over the same folder reads it back.
  assert.equal(fileStore(path.join(dir, 'secrets'), cipher, 'encrypted').get('review-host:github.com'), 'ghp_token_value');
  s.delete('review-host:github.com');
  assert.equal(s.get('review-host:github.com'), null);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('a key that could name a path is refused', () => {
  assert.throws(() => memoryStore('x').set('../../etc/passwd', 'v'), /Not a secret key/);
  assert.throws(() => memoryStore('x').set('Review Host', 'v'), /Not a secret key/);
});
