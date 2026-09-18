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
