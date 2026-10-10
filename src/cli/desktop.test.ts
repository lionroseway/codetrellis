/**
 * `codetrellis desktop install | url`: the right installer for the platform,
 * downloaded through the verified path, saved where asked, opened only when
 * it is this computer's and the person did not say --no-open.
 *
 * The release lookup runs against a local stand-in for GitHub's API
 * (CODETRELLIS_GITHUB_API), and the download and copy are the injected seams
 * the real command fills with update-download-service, whose own tests cover
 * the signed manifest and the pinned hosts.
 */

import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import type { AddressInfo } from 'node:net';
import { parseArgs } from './args';
import { desktop, DesktopUsageError, type DesktopDeps } from './desktop';
import { findDesktopRelease } from '../backend/services/update-service';
import type { UpdateDownloadState } from '../backend/services/update-download-service';

const asset = (name: string) => ({
  name,
  browser_download_url: `https://github.com/lionroseway/codetrellis-releases/releases/download/v0.2.0/${name}`,
  size: 1234,
  content_type: 'application/octet-stream',
  digest: `sha256:${'a'.repeat(64)}`,
});
const RELEASE = {
  tag_name: 'v0.2.0',
  html_url: 'https://github.com/lionroseway/codetrellis-releases/releases/tag/v0.2.0',
  assets: [
    asset('CodeTrellis-0.2.0-arm64.dmg'),
    asset('CodeTrellis-0.2.0-x64.dmg'),
    asset('CodeTrellis-Setup-0.2.0.exe'),
    asset('CodeTrellis-Portable-0.2.0.exe'),
    asset('CodeTrellis-0.2.0-x86_64.AppImage'),
    asset('SHA256SUMS'),
    asset('SHA256SUMS.sig'),
  ],
};

let server: http.Server;
const asked: string[] = [];

before(async () => {
  server = http.createServer((req, res) => {
    asked.push(req.url ?? '');
    const body = req.url === '/repos/lionroseway/codetrellis-releases/releases/latest' || req.url === '/repos/lionroseway/codetrellis-releases/releases/tags/v0.2.0'
      ? RELEASE
      : null;
    res.writeHead(body ? 200 : 404, { 'content-type': 'application/json' });
    res.end(JSON.stringify(body ?? { message: 'Not Found' }));
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  process.env.CODETRELLIS_GITHUB_API = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

after(() => {
  delete process.env.CODETRELLIS_GITHUB_API;
  server.close();
});

describe('findDesktopRelease', () => {
  test('the latest release, and each platform its own installer', async () => {
    const mac = await findDesktopRelease('darwin-arm64');
    assert.equal(mac.version, '0.2.0');
    assert.equal(mac.download?.filename, 'CodeTrellis-0.2.0-arm64.dmg');
    assert.equal(mac.download?.sha256, 'a'.repeat(64));
    assert.equal((await findDesktopRelease('win32-x64')).download?.filename, 'CodeTrellis-Setup-0.2.0.exe');
    assert.equal((await findDesktopRelease('linux-x64')).download?.filename, 'CodeTrellis-0.2.0-x86_64.AppImage');
  });

  test('a platform the release skipped has no installer, rather than another arch\'s', async () => {
    assert.equal((await findDesktopRelease('linux-arm64')).download, null);
  });

  test('a named version asks for its tag; one that does not exist says so', async () => {
    assert.equal((await findDesktopRelease('darwin-x64', '0.2.0')).download?.filename, 'CodeTrellis-0.2.0-x64.dmg');
    assert.ok(asked.includes('/repos/lionroseway/codetrellis-releases/releases/tags/v0.2.0'));
    await assert.rejects(findDesktopRelease('darwin-x64', '9.9.9'), /no CodeTrellis 9\.9\.9 release/);
  });

  test('a version is a version, not a path', async () => {
    await assert.rejects(findDesktopRelease('darwin-x64', '../../user'), /is not a version/);
  });
});

describe('codetrellis desktop', () => {
  let dir: string;
  before(() => { dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ct-desktop-')); });
  after(() => fs.rmSync(dir, { recursive: true, force: true }));

  function deps(over: Partial<DesktopDeps> = {}) {
    const opened: string[] = [];
    const downloads: string[] = [];
    const d: DesktopDeps = {
      platform: 'darwin-arm64',
      findRelease: findDesktopRelease,
      download: async (version, info): Promise<UpdateDownloadState> => {
        downloads.push(`${version} ${info.filename}`);
        return { phase: 'ready', version, filename: info.filename, bytesDownloaded: 4, totalBytes: 4, filePath: '/verified', error: null, sha256: 'a'.repeat(64), savedPath: null };
      },
      saveCopy: async (dest) => { fs.writeFileSync(dest, 'app'); return dest; },
      open: (f) => { opened.push(f); },
      downloadsDir: dir,
      ...over,
    };
    return { d, opened, downloads };
  }
  const run = (argv: string, d: DesktopDeps) => desktop(parseArgs(argv.split(' ')), d);

  test('url prints the link for this computer; --json says what it is', async () => {
    const { d, downloads } = deps();
    assert.equal((await run('desktop url', d)).out, RELEASE.assets[0].browser_download_url);
    const j = JSON.parse((await run('desktop url --platform win32-x64 --json', d)).out);
    assert.deepEqual(j, { version: '0.2.0', platform: 'win32-x64', filename: 'CodeTrellis-Setup-0.2.0.exe', url: RELEASE.assets[2].browser_download_url, size: 1234 });
    assert.deepEqual(downloads, [], 'url downloads nothing');
  });

  test('install downloads through the verified path, saves it to the folder, and opens it', async () => {
    const { d, opened, downloads } = deps();
    const r = await run(`desktop install --dir ${dir}`, d);
    assert.equal(r.code, 0);
    assert.deepEqual(downloads, ['0.2.0 CodeTrellis-0.2.0-arm64.dmg']);
    assert.deepEqual(opened, [path.join(dir, 'CodeTrellis-0.2.0-arm64.dmg')]);
    assert.match(r.out, /checked against the release's signed checksums/);
  });

  test('--no-open, and another computer\'s installer, only download', async () => {
    const a = deps();
    await run(`desktop install --dir ${dir} --no-open`, a.d);
    assert.deepEqual(a.opened, []);
    const b = deps();
    const r = JSON.parse((await run(`desktop install --dir ${dir} --platform win32-x64 --json`, b.d)).out);
    assert.deepEqual(b.opened, []);
    assert.equal(r.opened, false);
    assert.equal(r.path, path.join(dir, 'CodeTrellis-Setup-0.2.0.exe'));
  });

  test('an AppImage is made runnable, and its path is how to run it', async () => {
    const { d, opened } = deps({ platform: 'linux-x64' });
    const r = await run(`desktop install --dir ${dir}`, d);
    const file = path.join(dir, 'CodeTrellis-0.2.0-x86_64.AppImage');
    assert.equal(fs.statSync(file).mode & 0o111, 0o111);
    assert.deepEqual(opened, []);
    assert.match(r.out, new RegExp(`Run it with: ${file.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`));
  });

  test('a download that fails verification is reported, saved nowhere, and exits 1', async () => {
    const { d, opened } = deps({
      download: async (version, info) => ({ phase: 'error', version, filename: info.filename, bytesDownloaded: 0, totalBytes: null, filePath: null, error: 'Downloaded file does not match the published checksum. It has been deleted.', sha256: null, savedPath: null }),
      saveCopy: async () => { throw new Error('must not be called'); },
    });
    const r = await run(`desktop install --dir ${dir}`, d);
    assert.equal(r.code, 1);
    assert.match(r.out, /does not match the published checksum/);
    assert.deepEqual(opened, []);
  });

  test('no installer for the platform exits 1 and says so', async () => {
    const r = await run('desktop install --platform linux-arm64', deps().d);
    assert.equal(r.code, 1);
    assert.equal(r.out, 'CodeTrellis 0.2.0 has no installer for linux-arm64.');
  });

  test('a missing subcommand or an unknown platform is a usage error', async () => {
    await assert.rejects(run('desktop', deps().d), DesktopUsageError);
    await assert.rejects(run('desktop url --platform beos', deps().d), /--platform must be one of/);
  });
});
