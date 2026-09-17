/**
 * Finding 23 — the update download surface.
 *
 * The URL and digest come from the update state the backend already fetched,
 * never from the request. That is the property worth asserting at this level:
 * a caller must not be able to name what gets downloaded, or the renderer —
 * and anything that reaches it — gains an arbitrary-fetch primitive pointed at
 * the user's disk.
 *
 * NOT COVERED HERE: the streaming download and the hash-mismatch deletion. The
 * host is pinned to GitHub's release hosts, so a local fixture server cannot
 * stand in for one, and adding an override to allow that would ship the exact
 * bypass this is meant to prevent. The guards around it — host pinning,
 * filename reduction, digest comparison, and refusing a release with no
 * checksum — are unit-tested in `update-download-service.test.ts`.
 */

import { test, expect } from '@playwright/test';
import { setupHarness } from '../harness';

test.describe('23 — downloads are driven by state, not by the caller', () => {
  test('there is nothing to download until a check says so', async () => {
    const h = await setupHarness('update-download-no-update');
    try {
      const res = await h.client.raw('POST', '/api/updates/download');
      expect(res.status, 'no available update means nothing to fetch').toBe(409);

      const body = await res.json();
      expect(body.error).toMatch(/no update/i);
    } finally {
      await h.teardown();
    }
  });

  test('the request body cannot name a URL', async () => {
    // The whole point. If this were honoured, anything that could reach the
    // API could make the desktop fetch an arbitrary host to an arbitrary file.
    const h = await setupHarness('update-download-no-caller-url');
    try {
      const res = await h.client.raw('POST', '/api/updates/download', {
        url: 'https://evil.example/payload.dmg',
        filename: '../../../etc/cron.d/evil',
        sha256: 'a'.repeat(64),
      });

      expect(res.status, 'the body is ignored; state says no update').toBe(409);
      const body = await res.text();
      expect(body, 'and nothing echoes the attacker-supplied values back').not.toContain('evil.example');
    } finally {
      await h.teardown();
    }
  });

  test('status starts idle and is readable without starting anything', async () => {
    const h = await setupHarness('update-download-status');
    try {
      const state = await h.client.raw('GET', '/api/updates/download/status').then((r) => r.json());
      expect(state.phase).toBe('idle');
      expect(state.filePath, 'nothing on disk until something is verified').toBeNull();
      expect(state.bytesDownloaded).toBe(0);
    } finally {
      await h.teardown();
    }
  });

  test('cancel is safe when nothing is running', async () => {
    const h = await setupHarness('update-download-cancel-idle');
    try {
      const res = await h.client.raw('POST', '/api/updates/download/cancel');
      expect(res.ok).toBe(true);
      expect((await res.json()).phase).toBe('idle');
    } finally {
      await h.teardown();
    }
  });
});
