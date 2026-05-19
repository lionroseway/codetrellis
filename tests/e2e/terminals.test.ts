/**
 * Terminal API tests — exercises the CRUD lifecycle for terminal
 * sessions exposed by the backend:
 *
 *   1. POST /api/terminals         — create a terminal session
 *   2. GET  /api/terminals         — list all terminal sessions
 *   3. POST /api/terminals/:id/inject — inject text into a session
 *   4. DELETE /api/terminals/:id   — kill a terminal session
 *
 * Uses a shared harness across all tests (serial execution) so
 * terminal IDs created in earlier tests are available in later ones.
 */

import { test, expect } from '@playwright/test';
import { setupHarness, type Harness } from '../harness';

test.describe.serial('Terminals API', () => {
  test.setTimeout(120_000);

  let h: Harness;
  /** ID of the first terminal (preset: shell), created in test 1. */
  let shellId: string;
  /** ID of the second terminal (preset: claude), created in test 2. */
  let claudeId: string;
  /** Whether node-pty can spawn shells in this environment. */
  let ptyAvailable = true;

  test.beforeAll(async () => {
    h = await setupHarness('terminals');
    // Probe whether node-pty works (sandboxed environments block posix_spawnp)
    const probe = await h.client.raw('POST', '/api/terminals', {
      preset: 'shell',
      cwd: h.fixture.projectPath,
      title: '__probe__',
    });
    if (!probe.ok) {
      const errText = await probe.text();
      if (errText.includes('posix_spawnp')) {
        ptyAvailable = false;
      }
    } else {
      // Clean up probe terminal
      const session = await probe.json();
      await h.client.raw('DELETE', `/api/terminals/${session.id}`);
    }
  });

  test.afterAll(async () => {
    await h?.teardown();
  });

  test('create a shell terminal and verify all fields', async () => {
    test.skip(!ptyAvailable, 'node-pty posix_spawnp blocked (sandboxed environment)');
    const res = await h.client.raw('POST', '/api/terminals', {
      preset: 'shell',
      cwd: h.fixture.projectPath,
      title: 'Test Shell',
    });
    expect(res.ok).toBe(true);

    const session = await res.json();
    expect(typeof session.id).toBe('string');
    expect(session.id.length).toBeGreaterThan(0);
    expect(session.preset).toBe('shell');
    expect(session.title).toBe('Test Shell');
    expect(session.cwd).toBe(h.fixture.projectPath);
    expect(typeof session.pid).toBe('number');
    expect(session.pid).toBeGreaterThan(0);
    expect(session.createdAt).toBeTruthy();
    expect(session.alive).toBe(true);

    shellId = session.id;
  });

  test('create a claude terminal, list terminals, verify both appear', async () => {
    test.skip(!ptyAvailable, 'node-pty posix_spawnp blocked (sandboxed environment)');
    const createRes = await h.client.raw('POST', '/api/terminals', {
      preset: 'claude',
      cwd: h.fixture.projectPath,
      title: 'Test Claude',
    });
    expect(createRes.ok).toBe(true);

    const session = await createRes.json();
    expect(session.preset).toBe('claude');
    expect(session.alive).toBe(true);
    claudeId = session.id;

    const listRes = await h.client.raw('GET', '/api/terminals');
    expect(listRes.ok).toBe(true);

    const sessions: Array<{ id: string; preset: string }> = await listRes.json();
    const ids = sessions.map((s) => s.id);
    expect(ids).toContain(shellId);
    expect(ids).toContain(claudeId);
  });

  test('inject text into a terminal', async () => {
    test.skip(!ptyAvailable, 'node-pty posix_spawnp blocked (sandboxed environment)');
    const res = await h.client.raw('POST', `/api/terminals/${shellId}/inject`, {
      text: 'echo hello',
    });
    expect(res.ok).toBe(true);

    const body = await res.json();
    expect(body.ok).toBe(true);
  });

  test('kill a terminal, verify it disappears or is marked dead', async () => {
    test.skip(!ptyAvailable, 'node-pty posix_spawnp blocked (sandboxed environment)');
    const killRes = await h.client.raw('DELETE', `/api/terminals/${shellId}`);
    expect(killRes.ok).toBe(true);

    const killBody = await killRes.json();
    expect(killBody.ok).toBe(true);

    const listRes = await h.client.raw('GET', '/api/terminals');
    expect(listRes.ok).toBe(true);

    const sessions: Array<{ id: string; alive: boolean }> = await listRes.json();
    const killed = sessions.find((s) => s.id === shellId);
    // The session should either be absent from the list or marked as
    // no longer alive — both behaviours are acceptable.
    if (killed) {
      expect(killed.alive).toBe(false);
    } else {
      // Absent from the list — that's fine too.
      expect(sessions.every((s) => s.id !== shellId)).toBe(true);
    }
  });

  test('inject into a killed terminal fails gracefully', async () => {
    test.skip(!ptyAvailable, 'node-pty posix_spawnp blocked (sandboxed environment)');
    const res = await h.client.raw('POST', `/api/terminals/${shellId}/inject`, {
      text: 'echo should fail',
    });
    // The server should respond with an error status (4xx or 5xx) or
    // a JSON body indicating failure — either is acceptable.
    if (res.ok) {
      const body = await res.json();
      expect(body.ok).toBe(false);
    } else {
      expect(res.status).toBeGreaterThanOrEqual(400);
    }
  });
});
