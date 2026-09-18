/**
 * Active-agent detection — Phase 29.
 *
 * See [docs/PHASE-29-SURFACING-WHAT-WE-COLLECT.md](../../docs/PHASE-29-SURFACING-WHAT-WE-COLLECT.md).
 *
 * `/api/auto-detect` reads `~/.claude/sessions`, keeps only sessions
 * whose pid is still alive, dedupes by working directory and reads the
 * branch from `.git/HEAD`. It has always worked and nothing has ever
 * called it; the welcome screen now does.
 *
 * The liveness check is the part worth testing. A suggestion to open a
 * project because "an agent is working there" is worse than no
 * suggestion if the agent exited an hour ago — so a stale session file
 * must be ignored, and this asserts it with a pid that cannot be alive.
 */

import { test, expect } from '@playwright/test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { setupHarness } from '../harness';

interface DetectResponse {
  sessions: Array<{ projectPath: string; sessionId: string; name: string; branch: string | null }>;
}

const SESSIONS_DIR = path.join(os.homedir(), '.claude', 'sessions');

/** Write a session file, returning a cleanup function. */
function writeSession(id: string, body: Record<string, unknown>): () => void {
  fs.mkdirSync(SESSIONS_DIR, { recursive: true });
  const file = path.join(SESSIONS_DIR, `${id}.json`);
  fs.writeFileSync(file, JSON.stringify(body), 'utf-8');
  return () => { try { fs.unlinkSync(file); } catch { /* already gone */ } };
}

test.describe('Active-agent detection (Phase 29)', () => {
  test.setTimeout(120_000);

  test('a live session is reported with its path and branch', async () => {
    const h = await setupHarness('auto-detect-live');
    // `process.pid` is this test runner, which is definitely alive — the
    // simplest honest way to present a live session to the endpoint.
    const cleanup = writeSession('ct-test-live', {
      pid: process.pid,
      cwd: h.fixture.projectPath,
      sessionId: 'ct-test-live',
      name: 'fixture-project',
    });
    try {
      const res = await h.client.raw('GET', '/api/auto-detect');
      expect(res.ok).toBe(true);
      const body = (await res.json()) as DetectResponse;

      const found = body.sessions.find((s) => s.sessionId === 'ct-test-live');
      expect(found, 'a session with a live pid must be reported').toBeTruthy();
      expect(found!.projectPath).toBe(h.fixture.projectPath);
      expect(found!.name).toBe('fixture-project');
      // The harness git-inits every fixture on `main`.
      expect(found!.branch).toBe('main');
    } finally {
      cleanup();
      await h.teardown();
    }
  });

  test('a session whose process is gone is not suggested', async () => {
    const h = await setupHarness('auto-detect-stale');
    // pid 2^22 is above every default pid_max, so it cannot be running.
    // Suggesting "an agent is working here" about an agent that exited
    // is worse than suggesting nothing.
    const cleanup = writeSession('ct-test-stale', {
      pid: 4194304,
      cwd: h.fixture.projectPath,
      sessionId: 'ct-test-stale',
      name: 'stale-project',
    });
    try {
      const body = (await (await h.client.raw('GET', '/api/auto-detect')).json()) as DetectResponse;
      expect(
        body.sessions.find((s) => s.sessionId === 'ct-test-stale'),
        'a dead session must not be suggested',
      ).toBeUndefined();
    } finally {
      cleanup();
      await h.teardown();
    }
  });

  test('a session pointing at a path that no longer exists is skipped', async () => {
    const h = await setupHarness('auto-detect-missing');
    const cleanup = writeSession('ct-test-missing', {
      pid: process.pid,
      cwd: path.join(h.fixture.tmpDir, 'deleted-long-ago'),
      sessionId: 'ct-test-missing',
      name: 'gone',
    });
    try {
      const body = (await (await h.client.raw('GET', '/api/auto-detect')).json()) as DetectResponse;
      expect(
        body.sessions.find((s) => s.sessionId === 'ct-test-missing'),
        'a session whose directory is gone must not be suggested',
      ).toBeUndefined();
    } finally {
      cleanup();
      await h.teardown();
    }
  });

  test('two sessions in the same directory are reported once', async () => {
    const h = await setupHarness('auto-detect-dedupe');
    // Two Claude Code windows on one repo is ordinary. Offering the
    // same project twice is not.
    const a = writeSession('ct-test-dupe-a', {
      pid: process.pid, cwd: h.fixture.projectPath, sessionId: 'ct-test-dupe-a', name: 'p',
    });
    const b = writeSession('ct-test-dupe-b', {
      pid: process.pid, cwd: h.fixture.projectPath, sessionId: 'ct-test-dupe-b', name: 'p',
    });
    try {
      const body = (await (await h.client.raw('GET', '/api/auto-detect')).json()) as DetectResponse;
      const atPath = body.sessions.filter((s) => s.projectPath === h.fixture.projectPath);
      expect(atPath).toHaveLength(1);
    } finally {
      a(); b();
      await h.teardown();
    }
  });

  test('a malformed session file does not break detection', async () => {
    const h = await setupHarness('auto-detect-malformed');
    const bad = writeSession('ct-test-bad', {});
    fs.writeFileSync(path.join(SESSIONS_DIR, 'ct-test-bad.json'), '{ not json', 'utf-8');
    const good = writeSession('ct-test-good', {
      pid: process.pid, cwd: h.fixture.projectPath, sessionId: 'ct-test-good', name: 'p',
    });
    try {
      const res = await h.client.raw('GET', '/api/auto-detect');
      expect(res.ok, 'one unreadable file must not fail the whole endpoint').toBe(true);
      const body = (await res.json()) as DetectResponse;
      expect(body.sessions.find((s) => s.sessionId === 'ct-test-good')).toBeTruthy();
    } finally {
      bad(); good();
      await h.teardown();
    }
  });
});
