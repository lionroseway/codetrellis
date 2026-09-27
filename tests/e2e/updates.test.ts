/**
 * The update check, against a stand-in for codetrellis.dev and GitHub
 * (Phase 32 §0.4k).
 *
 * CLAUDE.md: "The only request the app makes on its own is the update check,
 * and Settings → Updates turns it off." This checks both halves — the check
 * the backend makes at start, and that turning it off means no request at
 * all — plus what a person's own "Check for updates" gets back in each case,
 * and that a download is only ever fetched from the releases repo.
 *
 * Nothing here leaves the machine: both sources point at a local server.
 */

import { test, expect } from '@playwright/test';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { setupHarness, type Harness } from '../harness';

interface Stub {
  url: string;
  hits: string[];
  /** What the website answers; `null` answers 500. */
  website: Record<string, unknown> | null;
  /** What GitHub answers; `null` answers 503. */
  github: Record<string, unknown> | null;
  close(): Promise<void>;
}

async function startStub(): Promise<Stub> {
  const stub = { hits: [] as string[], website: null, github: null } as unknown as Stub;
  const server = http.createServer((req, res) => {
    stub.hits.push(req.url ?? '');
    const send = (status: number, body: unknown) => {
      res.writeHead(status, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(body));
    };
    if (req.url?.startsWith('/api/updates/check')) return stub.website ? send(200, stub.website) : send(500, { error: 'down' });
    if (req.url?.startsWith('/repos/')) return stub.github ? send(200, stub.github) : send(503, { error: 'down' });
    // Anything else is a download attempt — which must never happen.
    res.writeHead(200, { 'Content-Type': 'application/octet-stream' });
    res.end('not a real installer');
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  stub.url = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  stub.close = () => new Promise<void>((r) => server.close(() => r()));
  return stub;
}

const pause = (ms: number) => new Promise((r) => setTimeout(r, ms));

test.describe('The update check', () => {
  test.setTimeout(90_000);

  let stub: Stub;
  test.beforeEach(async () => { stub = await startStub(); });
  test.afterEach(async () => { await stub.close(); });

  const boot = (name: string, autoCheck: boolean): Promise<Harness> => setupHarness(name, {
    env: { CODETRELLIS_OTA_URL: stub.url, CODETRELLIS_GITHUB_API: stub.url },
    settings: { updates: { autoCheck } },
  });

  test('on: the backend asks once at start, naming its platform and version, and reports what it heard', async () => {
    stub.website = {
      available: true, latest: '99.0.0',
      download: { url: 'https://github.com/lionroseway/codetrellis-releases/releases/download/v99.0.0/CodeTrellis-99.0.0.AppImage', filename: 'CodeTrellis-99.0.0.AppImage', size: 1 },
    };
    const h = await boot('updates-auto-on', true);
    try {
      await expect.poll(async () => (await (await h.client.raw('GET', '/api/updates/status')).json()).status, { timeout: 15_000 }).toBe('available');
      const state = await (await h.client.raw('GET', '/api/updates/status')).json();
      expect(stub.hits).toHaveLength(1);
      const asked = new URL(stub.hits[0], stub.url);
      expect(asked.pathname).toBe('/api/updates/check');
      expect(asked.searchParams.get('platform')).toBe(state.platform);
      expect(asked.searchParams.get('current')).toBe(state.currentVersion);
      expect(state.result).toMatchObject({ available: true, latest: '99.0.0', source: 'website' });
    } finally {
      await h.teardown();
    }
  });

  test('off: no request at all, however long it runs; a person\'s own check still works', async () => {
    stub.website = { available: false, latest: '0.0.1' };
    const h = await boot('updates-auto-off', false);
    try {
      await pause(3000);
      expect(stub.hits, 'the backend reached the update server with the check turned off').toEqual([]);
      expect((await (await h.client.raw('GET', '/api/updates/status')).json()).status).toBe('idle');

      // "Check for updates" is the person asking: it goes out, once.
      const checked = await (await h.client.raw('POST', '/api/updates/check')).json();
      expect(checked).toMatchObject({ status: 'up-to-date', result: { available: false, source: 'website' } });
      expect(stub.hits).toHaveLength(1);
    } finally {
      await h.teardown();
    }
  });

  test('a newer release with nothing this platform can run is not offered, and says why', async () => {
    stub.website = { available: true, latest: '99.0.0' };
    const h = await boot('updates-no-asset', false);
    try {
      const checked = await (await h.client.raw('POST', '/api/updates/check')).json();
      expect(checked.status).toBe('up-to-date');
      expect(checked.result).toMatchObject({ available: false, noAssetForPlatform: true, latest: '99.0.0' });
    } finally {
      await h.teardown();
    }
  });

  test('the website down: GitHub answers instead; both down: an error the panel can show, not a crash', async () => {
    stub.github = { tag_name: 'v0.0.1', assets: [] };
    const h = await boot('updates-fallback', false);
    try {
      const viaGithub = await (await h.client.raw('POST', '/api/updates/check')).json();
      expect(viaGithub).toMatchObject({ status: 'up-to-date', result: { source: 'github', latest: '0.0.1' } });
      expect(stub.hits.map((u) => u.split('?')[0])).toEqual(['/api/updates/check', '/repos/lionroseway/codetrellis-releases/releases/latest']);

      stub.github = null;
      const failed = await (await h.client.raw('POST', '/api/updates/check')).json();
      expect(failed.status).toBe('error');
      expect(failed.lastError).toMatch(/GitHub releases API 503/);
      // The last good answer is kept for the panel.
      expect(failed.result).toMatchObject({ source: 'github' });
    } finally {
      await h.teardown();
    }
  });

  test('an update whose download is not on the releases repo is refused, and nothing is fetched from it', async () => {
    stub.website = {
      available: true, latest: '99.0.0',
      download: { url: `${stub.url}/CodeTrellis-99.0.0.AppImage`, filename: 'CodeTrellis-99.0.0.AppImage', size: 20 },
    };
    const h = await boot('updates-download-host', false);
    try {
      expect((await (await h.client.raw('POST', '/api/updates/check')).json()).status).toBe('available');
      const res = await h.client.raw('POST', '/api/updates/download');
      expect(res.status).toBe(502);
      const outcome = await res.json();
      expect(outcome).toMatchObject({ phase: 'error', filePath: null });
      expect(outcome.error).toMatch(/must be https/);
      expect(stub.hits.filter((u) => u.includes('CodeTrellis-99.0.0') || u.includes('SHA256SUMS')), 'fetched from a host that is not the releases repo').toEqual([]);

      // https, but not GitHub's: refused on the host.
      stub.website = { ...stub.website, download: { url: 'https://downloads.example.com/CodeTrellis-99.0.0.AppImage', filename: 'CodeTrellis-99.0.0.AppImage', size: 20 } };
      expect((await (await h.client.raw('POST', '/api/updates/check')).json()).status).toBe('available');
      const other = await (await h.client.raw('POST', '/api/updates/download')).json();
      expect(other).toMatchObject({ phase: 'error', filePath: null });
      expect(other.error).toMatch(/downloads\.example\.com/);
    } finally {
      await h.teardown();
    }
  });
});
