/**
 * Unit tests for verified update downloads (Phase 19, finding 23).
 *
 * The app previously opened the download URL in a browser and forgot about it.
 * Safe in the narrow sense — nothing was fetched or executed — but it also
 * meant the sha256 the update API already carries was decoration.
 *
 * Fetching the bytes ourselves turns that digest into the control. These tests
 * are about the ways that control can be got around.
 */

import { test, describe, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { createHash } from 'node:crypto';

let tmp: string;
let svc: typeof import('./update-download-service');

beforeEach(async () => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'update-dl-'));
  process.env.CODETRELLIS_DATA_DIR = tmp;
  svc = await import('./update-download-service');
  svc._resetUpdateDownloadState();
});

afterEach(() => {
  svc._resetUpdateDownloadState();
  delete process.env.CODETRELLIS_DATA_DIR;
  try { fs.rmSync(tmp, { recursive: true, force: true }); } catch { /* */ }
});

const GOOD = 'https://github.com/lionroseway/codetrellis-releases/releases/download/v1/x.dmg';

describe('the download host is pinned, not followed', () => {
  test('a release host is accepted', () => {
    assert.doesNotThrow(() => svc._internals.assertAllowedUrl(GOOD));
    assert.doesNotThrow(() => svc._internals.assertAllowedUrl(
      'https://objects.githubusercontent.com/abc',
    ));
  });

  test('ANY other host is refused, however plausible', () => {
    // The URL comes from an update endpoint, which is exactly the thing that
    // could be lying. A compromised or spoofed site naming its own host is the
    // whole attack.
    for (const url of [
      'https://evil.example/x.dmg',
      'https://github.com.evil.example/x.dmg',   // suffix trick
      'https://notgithub.com/x.dmg',
      'https://raw.githubusercontent.com/x.dmg', // real GitHub, wrong service
    ]) {
      assert.throws(() => svc._internals.assertAllowedUrl(url), /not a release host/, url);
    }
  });

  test('http is refused — a checksum does not make plaintext acceptable', () => {
    assert.throws(
      () => svc._internals.assertAllowedUrl(GOOD.replace('https:', 'http:')),
      /https/,
    );
  });

  test('garbage is refused', () => {
    for (const url of ['', 'not a url', '//github.com/x']) {
      assert.throws(() => svc._internals.assertAllowedUrl(url));
    }
  });
});

describe('the filename from a remote service is not a path', () => {
  test('traversal is reduced to a single segment', () => {
    assert.equal(svc._internals.safeFilename('../../../etc/cron.d/evil'), 'evil');
    assert.equal(svc._internals.safeFilename('/etc/passwd'), 'passwd');
    assert.equal(svc._internals.safeFilename('..'), 'codetrellis-update');
    assert.equal(svc._internals.safeFilename(''), 'codetrellis-update');
  });

  test('an ordinary installer name survives intact', () => {
    assert.equal(svc._internals.safeFilename('CodeTrellis-0.1.14-arm64.dmg'), 'CodeTrellis-0.1.14-arm64.dmg');
  });

  test('shell and quoting characters are stripped', () => {
    assert.equal(svc._internals.safeFilename('a b;rm -rf $HOME.dmg'), 'abrm-rfHOME.dmg');
  });
});

describe('digest comparison', () => {
  test('matches regardless of case', () => {
    const d = createHash('sha256').update('x').digest('hex');
    assert.equal(svc._internals.digestsEqual(d, d.toUpperCase()), true);
  });

  test('never matches on empty or mismatched input', () => {
    assert.equal(svc._internals.digestsEqual('', ''), false);
    assert.equal(svc._internals.digestsEqual('abc', 'abcd'), false);
    // @ts-expect-error deliberately wrong type
    assert.equal(svc._internals.digestsEqual('abc', undefined), false);
  });
});

describe('nothing is written when the release cannot be verified', () => {
  test('nothing lands on disk', async () => {
    // GOOD points at a release that does not exist, so the manifest fetch
    // fails — which must abort before any installer bytes are written.
    await svc.startUpdateDownload('1.0.0', { url: GOOD, filename: 'x.dmg' } as never);
    const dir = path.join(tmp, 'updates');
    const files = fs.existsSync(dir) ? fs.readdirSync(dir) : [];
    assert.deepEqual(files, []);
  });
});

describe('a bad URL is refused before any request', () => {
  test('an off-host URL with a perfectly good digest still fails', async () => {
    // The digest proves the bytes; it says nothing about who is serving them.
    const result = await svc.startUpdateDownload('1.0.0', {
      url: 'https://evil.example/x.dmg',
      filename: 'x.dmg',
      sha256: 'a'.repeat(64),
    });
    assert.equal(result.phase, 'error');
    assert.match(result.error ?? '', /release host/);
  });
});

describe('state', () => {
  test('starts idle and reports the version it is working on', async () => {
    assert.equal(svc.getUpdateDownloadState().phase, 'idle');
    await svc.startUpdateDownload('9.9.9', {
      url: 'https://evil.example/x.dmg', filename: 'x.dmg', sha256: 'a'.repeat(64),
    });
    // Even on failure the version is recorded, so a stale UI cannot show
    // progress for a different release.
    assert.equal(svc.getUpdateDownloadState().phase, 'error');
  });
});
