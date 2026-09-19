/**
 * Two ways the updater answered a partial release badly.
 *
 * v0.1.14 ships the full platform matrix, so neither bites today. Both
 * are one incomplete release away: `release.sh` collects artifacts with
 * `[[ -f "$f" ]] &&` and has a `--mac-only` mode, so a failed x64 build
 * or a partial CI upload publishes anyway with no completeness check.
 */

import { test, describe, after } from 'node:test';
import assert from 'node:assert/strict';
import { pickAssetForPlatform, checkForUpdate, getUpdateState } from './update-service';

const asset = (name: string) => ({
  name,
  browser_download_url: `https://example.invalid/${name}`,
  size: 1,
  content_type: 'application/octet-stream',
});

describe('an installer the user cannot run is not a fallback (m20)', () => {
  const armOnly = [asset('CodeTrellis-0.1.15-arm64.dmg'), asset('CodeTrellis-0.1.15-arm64.AppImage')];

  test('an Intel Mac is not offered the arm64 DMG', () => {
    // The pattern list ended in an arch-agnostic `/\.dmg$/i`. With only
    // the arm64 build published it matched, and because the wrong-arch
    // installer is in the SIGNED manifest it downloads, verifies, and
    // the panel reports success — for a binary that will not launch.
    assert.equal(pickAssetForPlatform(armOnly, 'darwin-x64'), null);
  });

  test('an x64 Linux box is not offered the arm64 AppImage', () => {
    assert.equal(pickAssetForPlatform(armOnly, 'linux-x64'), null);
  });

  test('each platform still gets its own build from a full release', () => {
    const full = [
      asset('CodeTrellis-0.1.15-arm64.dmg'),
      asset('CodeTrellis-0.1.15-x64.dmg'),
      asset('CodeTrellis-Setup-0.1.15.exe'),
      asset('CodeTrellis-Portable-0.1.15.exe'),
      asset('CodeTrellis-0.1.15-arm64.AppImage'),
      asset('CodeTrellis-0.1.15-x86_64.AppImage'),
    ];
    const name = (p: string) => pickAssetForPlatform(full, p)?.name ?? null;

    assert.equal(name('darwin-arm64'), 'CodeTrellis-0.1.15-arm64.dmg');
    assert.equal(name('darwin-x64'), 'CodeTrellis-0.1.15-x64.dmg');
    assert.equal(name('linux-arm64'), 'CodeTrellis-0.1.15-arm64.AppImage');
    assert.equal(name('linux-x64'), 'CodeTrellis-0.1.15-x86_64.AppImage');
    // Setup beats Portable — the ordering WITHIN an architecture is the
    // part that was always right and must stay.
    assert.equal(name('win32-x64'), 'CodeTrellis-Setup-0.1.15.exe');
  });

  test('an unrecognised platform gets nothing rather than something', () => {
    assert.equal(pickAssetForPlatform(armOnly, 'freebsd-x64'), null);
  });
});

describe('a release with nothing for this platform (m21)', () => {
  const realFetch = globalThis.fetch;

  const release = (assets: ReturnType<typeof asset>[]) => ({
    tag_name: 'v99.0.0',
    published_at: '2026-09-18T00:00:00Z',
    html_url: 'https://example.invalid/release',
    assets,
  });

  function stubGithub(body: unknown): void {
    globalThis.fetch = (async (url: string | URL | Request) => {
      const href = String(url);
      // The website is tried first; failing it exercises the GitHub path,
      // which is the one that computes `available` from the assets.
      if (!href.includes('api.github.com')) {
        return new Response('nope', { status: 503 });
      }
      return new Response(JSON.stringify(body), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    }) as typeof fetch;
  }

  after(() => { globalThis.fetch = realFetch; });

  test('a newer version with no runnable asset is not "available"', async () => {
    // `available: true` with no download matched NONE of the settings
    // panel's three status branches, so the whole status card rendered as
    // null: no update notice, no "you are up to date", no error. The user
    // saw the version hero and nothing else.
    stubGithub(release([asset('CodeTrellis-99.0.0-solaris-sparc.tar.gz')]));
    const state = await checkForUpdate({ force: true });

    assert.equal(state.result?.available, false);
    assert.equal(state.status, 'up-to-date');
    // But NOT silently: the reason is carried, because "you are on the
    // latest version" would be a lie the user can check.
    assert.equal(state.result?.noAssetForPlatform, true);
    assert.equal(state.result?.latest, '99.0.0');
  });

  test('a newer version WITH an asset for this platform is available', async () => {
    const p = getUpdateState().platform;
    const forThis: Record<string, string> = {
      'darwin-arm64': 'CodeTrellis-99.0.0-arm64.dmg',
      'darwin-x64': 'CodeTrellis-99.0.0-x64.dmg',
      'win32-x64': 'CodeTrellis-Setup-99.0.0.exe',
      'win32-arm64': 'CodeTrellis-Setup-99.0.0.exe',
      'linux-arm64': 'CodeTrellis-99.0.0-arm64.AppImage',
      'linux-x64': 'CodeTrellis-99.0.0-x86_64.AppImage',
    };
    const name = forThis[p];
    assert.ok(name, `this test has no artifact name for ${p}`);

    stubGithub(release([asset(name)]));
    const state = await checkForUpdate({ force: true });

    assert.equal(state.result?.available, true);
    assert.equal(state.status, 'available');
    assert.equal(state.result?.noAssetForPlatform, false);
    assert.equal(state.result?.download?.filename, name);
  });
});
