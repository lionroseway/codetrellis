/**
 * The verified update-download endpoints — Phase 29.
 *
 * See [docs/PHASE-29-SURFACING-WHAT-WE-COLLECT.md](../../docs/PHASE-29-SURFACING-WHAT-WE-COLLECT.md).
 *
 * `update-download-service.ts` is Phase 19 finding 23: it fetches the
 * bytes itself, pins the host on every redirect hop, and verifies the
 * file against a signed Ed25519 manifest. Its own unit tests cover the
 * verification logic. **Nothing ever called it** — Settings offered a
 * plain browser link, so every update this app has shipped was applied
 * unverified while the verified path sat unused.
 *
 * These tests cover the wiring the Settings panel now depends on, in the
 * state a test environment is actually in: no update available, no
 * network fetch attempted. The refusal path matters as much as the happy
 * one, because the UI has to render it rather than hang.
 */

import { test, expect } from '@playwright/test';
import { setupHarness } from '../harness';

interface DownloadState {
  phase: 'idle' | 'downloading' | 'verifying' | 'ready' | 'error';
  version: string | null;
  filename: string | null;
  bytesDownloaded: number;
  totalBytes: number | null;
  filePath: string | null;
  error: string | null;
}

test.describe('Verified update download (Phase 29)', () => {
  test.setTimeout(120_000);

  test('status is idle and complete before anything is downloaded', async () => {
    const h = await setupHarness('update-dl-idle');
    try {
      const res = await h.client.raw('GET', '/api/updates/download/status');
      expect(res.ok).toBe(true);
      const state = (await res.json()) as DownloadState;

      expect(state.phase).toBe('idle');
      expect(state.filePath, 'no path until bytes are verified').toBeNull();
      // Every field the panel reads must be present even when idle, or
      // it has an undefined to guard on rather than a state to render.
      expect(state).toHaveProperty('version');
      expect(state).toHaveProperty('filename');
      expect(state).toHaveProperty('totalBytes');
      expect(state).toHaveProperty('error');
      expect(state.bytesDownloaded).toBe(0);
    } finally {
      await h.teardown();
    }
  });

  test('downloading with no update available is refused, not attempted', async () => {
    const h = await setupHarness('update-dl-none');
    try {
      // 409 rather than a 500 or a hang: the panel renders this as an
      // error line and leaves the browser link available.
      const res = await h.client.raw('POST', '/api/updates/download');
      expect(res.status).toBe(409);
      const body = await res.json();
      expect(body.error).toMatch(/no update/i);

      // And the refusal must not have moved the state machine.
      const after = (await (await h.client.raw('GET', '/api/updates/download/status')).json()) as DownloadState;
      expect(after.phase).toBe('idle');
    } finally {
      await h.teardown();
    }
  });

  test('cancelling when nothing is running answers cleanly', async () => {
    const h = await setupHarness('update-dl-cancel');
    try {
      // The Cancel button is only rendered mid-flight, but a stale click
      // or a double-click must not 500.
      const res = await h.client.raw('POST', '/api/updates/download/cancel');
      expect(res.ok).toBe(true);
      const state = (await res.json()) as DownloadState;
      expect(['idle', 'error']).toContain(state.phase);
    } finally {
      await h.teardown();
    }
  });
});

test.describe('A caller cannot name the URL (Phase 19, finding 23)', () => {
  test.setTimeout(120_000);

  test('the request body is ignored, and nothing is echoed back', async () => {
    // Restored: this existed on main and was dropped in the rewrite. The
    // property is the whole point of the endpoint — if a caller-supplied URL
    // were honoured, anything that could reach the API could make the desktop
    // fetch an arbitrary host to an arbitrary path.
    //
    // Asserted HERE rather than against the service, because at the service
    // level the rejected host legitimately appears in the refusal message.
    // What must not happen is the REST surface accepting or reflecting it.
    const h = await setupHarness('update-download-no-caller-url');
    try {
      const res = await h.client.raw('POST', '/api/updates/download', {
        url: 'https://evil.example/payload.dmg',
        filename: '../../../etc/cron.d/evil',
        sha256: 'a'.repeat(64),
      });

      // The property is that the BODY IS IGNORED — not that no update
      // exists. This used to assert 409, which only held while the backend
      // believed it was up to date. Under the harness it reads its version
      // from the committed build-info, so the moment a newer release was
      // published the endpoint correctly started a real download (from
      // GitHub, body ignored), answered 200, and a security test went red
      // for a reason that had nothing to do with security. It also pulled a
      // full installer mid-suite.
      //
      // So: whatever the update state, nothing the caller sent may reach
      // the answer or the download.
      expect([409, 200, 502], `unexpected status ${res.status}`).toContain(res.status);
      const body = await res.text();
      expect(body, 'and nothing echoes the attacker-supplied values back').not.toContain('evil.example');
      expect(body).not.toContain('cron.d');

      const state = await (await h.client.raw('GET', '/api/updates/download/status')).text();
      expect(state, 'the download in flight is not the caller\'s').not.toContain('evil.example');
      expect(state).not.toContain('cron.d');
    } finally {
      // If an update WAS available, a real download started. Stop it.
      await h.client.raw('POST', '/api/updates/download/cancel').catch(() => {});
      await h.teardown();
    }
  });
});
