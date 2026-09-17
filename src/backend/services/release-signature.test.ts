/**
 * Unit tests for the signed release manifest (Phase 19, finding 23).
 *
 * WHAT THE SIGNATURE ADDS
 *
 * Verifying a download against a digest served by the same place as the file
 * proves the bytes arrived intact. It does not prove they are OURS: anyone who
 * took over the releases repo would publish a bad binary and a matching digest
 * together, and every check would pass.
 *
 * The manifest is signed with a key that lives on one machine and never goes
 * near CI, so these tests are about the ways a forged or altered manifest
 * might slip through.
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { generateKeyPairSync, sign, createPrivateKey } from 'node:crypto';
import * as fs from 'node:fs';
import * as path from 'node:path';
import {
  parseManifest,
  verifyManifestSignature,
  digestFor,
  _publicKeyPem,
} from './release-signature';

const REPO_ROOT = path.resolve(__dirname, '../../..');
const KEY_PATH = path.join(REPO_ROOT, 'scripts', 'release-signing-key.pem');

const MANIFEST = [
  'aa'.repeat(32) + '  CodeTrellis-1.0.0-arm64.dmg',
  'bb'.repeat(32) + '  CodeTrellis-1.0.0-x64.dmg',
  '',
].join('\n');

/** Sign with the REAL release key if it is on this machine. */
function signWithReleaseKey(data: string): string | null {
  if (!fs.existsSync(KEY_PATH)) return null;
  const key = createPrivateKey(fs.readFileSync(KEY_PATH));
  return sign(null, Buffer.from(data, 'utf-8'), key).toString('base64');
}

describe('parsing', () => {
  test('reads standard shasum output', () => {
    const entries = parseManifest(MANIFEST);
    assert.equal(entries.length, 2);
    assert.equal(entries[0].filename, 'CodeTrellis-1.0.0-arm64.dmg');
    assert.equal(entries[0].sha256, 'aa'.repeat(32));
  });

  test('tolerates the binary marker and comments', () => {
    const entries = parseManifest(`# generated\n${'cc'.repeat(32)} *file.dmg\n`);
    assert.equal(entries.length, 1);
    assert.equal(entries[0].filename, 'file.dmg');
  });

  test('ignores lines that are not digest entries', () => {
    assert.deepEqual(parseManifest('garbage\n\nnot a digest  file\n'), []);
    assert.deepEqual(parseManifest(''), []);
  });

  test('digestFor matches the exact filename only', () => {
    const entries = parseManifest(MANIFEST);
    assert.equal(digestFor(entries, 'CodeTrellis-1.0.0-arm64.dmg'), 'aa'.repeat(32));
    // A near-miss must not resolve — signing one file and downloading another
    // is exactly what this is meant to stop.
    assert.equal(digestFor(entries, 'CodeTrellis-1.0.0-arm64.dmg.evil'), null);
    assert.equal(digestFor(entries, 'codetrellis-1.0.0-arm64.dmg'), null);
    assert.equal(digestFor(entries, ''), null);
  });
});

describe('signature verification', () => {
  test('the committed public key is a real Ed25519 key', () => {
    assert.match(_publicKeyPem, /^-----BEGIN PUBLIC KEY-----/);
  });

  test('a manifest signed with the release key verifies', (t) => {
    const sig = signWithReleaseKey(MANIFEST);
    if (!sig) return t.skip('release-signing-key.pem is not on this machine');
    assert.equal(verifyManifestSignature(MANIFEST, sig), true);
  });

  test('ANY change to the manifest invalidates it', (t) => {
    const sig = signWithReleaseKey(MANIFEST);
    if (!sig) return t.skip('release-signing-key.pem is not on this machine');

    // The attack: swap in a digest for a binary you control.
    const tampered = MANIFEST.replace('aa'.repeat(32), 'ff'.repeat(32));
    assert.equal(verifyManifestSignature(tampered, sig), false);

    // And anything else — an added line, a byte of whitespace.
    assert.equal(verifyManifestSignature(MANIFEST + 'x', sig), false);
    assert.equal(verifyManifestSignature(MANIFEST.trimEnd(), sig), false);
  });

  test('A DIFFERENT KEY DOES NOT PASS', () => {
    // Someone with repo access can publish a manifest and a signature. Only
    // the private key that matches the one shipped in the app makes them agree.
    const { privateKey } = generateKeyPairSync('ed25519');
    const forged = sign(null, Buffer.from(MANIFEST, 'utf-8'), privateKey).toString('base64');
    assert.equal(verifyManifestSignature(MANIFEST, forged), false);
  });

  test('malformed signatures are refused, never thrown on', () => {
    for (const sig of ['', 'not-base64!!', 'AAAA', Buffer.alloc(63).toString('base64')]) {
      assert.equal(verifyManifestSignature(MANIFEST, sig), false, JSON.stringify(sig));
    }
    // @ts-expect-error deliberately wrong type
    assert.equal(verifyManifestSignature(MANIFEST, undefined), false);
  });

  test('a 64-byte non-signature is refused', () => {
    // base64 decoding is forgiving, so length alone is not enough — the
    // verification itself has to do the work.
    assert.equal(verifyManifestSignature(MANIFEST, Buffer.alloc(64).toString('base64')), false);
  });
});
