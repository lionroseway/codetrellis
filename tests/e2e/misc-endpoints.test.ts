/**
 * Miscellaneous endpoints — covers the remaining untested API surface:
 *
 *   - GET  /api/recent-projects              — project history list
 *   - DELETE /api/recent-projects            — remove from recent
 *   - POST /api/recent-projects/pin          — pin/unpin a project
 *   - GET  /api/onboarding-state             — onboarding checklist state
 *   - GET  /api/architecture-summary         — AI-generated architecture overview
 *   - GET  /api/file/content                 — read source file content
 *   - GET  /api/logs/tail                    — tail the backend log
 *   - GET  /api/logs/path                    — log file location
 *   - GET  /api/updates/status               — OTA update state
 *   - GET  /api/health                       — health check
 *   - GET  /api/mcp/config                   — MCP connection config
 *   - GET  /api/agent/status                 — agent watcher status
 *   - GET  /api/systems                      — discovered systems/packages
 *   - GET  /api/fs/browse                    — directory browser
 *
 * Grouped into a single file because each endpoint is small and
 * read-only (no cross-test state dependencies).
 */

import { test, expect } from '@playwright/test';
import path from 'node:path';
import { setupHarness, type Harness } from '../harness';

test.describe.serial('Miscellaneous endpoints', () => {
  test.setTimeout(120_000);

  let h: Harness;

  test.beforeAll(async () => {
    h = await setupHarness('misc-endpoints');
    await h.client.scanProject(h.fixture.projectPath);
  });

  test.afterAll(async () => {
    await h?.teardown();
  });

  // --- Recent Projects ---

  test('GET /api/recent-projects returns a list', async () => {
    const res = await h.client.raw('GET', '/api/recent-projects');
    expect(res.ok).toBe(true);
    const body = await res.json();
    expect(body).toHaveProperty('projects');
    expect(Array.isArray(body.projects)).toBe(true);
  });

  test('POST /api/recent-projects/pin toggles pin', async () => {
    const res = await h.client.raw('POST', '/api/recent-projects/pin', {
      projectPath: h.fixture.projectPath,
      pinned: true,
    });
    expect(res.ok).toBe(true);
    const body = await res.json();
    expect(body.ok).toBe(true);
  });

  test('DELETE /api/recent-projects removes a project', async () => {
    const res = await h.client.raw('DELETE', '/api/recent-projects', {
      projectPath: '/tmp/nonexistent-for-test',
    });
    expect(res.ok).toBe(true);
    const body = await res.json();
    expect(body.ok).toBe(true);
  });

  // --- Onboarding ---

  test('GET /api/onboarding-state returns checklist state', async () => {
    const encodedPath = encodeURIComponent(h.fixture.projectPath);
    const res = await h.client.raw('GET', `/api/onboarding-state?project=${encodedPath}`);
    expect(res.ok).toBe(true);
    const body = await res.json();
    expect(typeof body.hasPlan).toBe('boolean');
    expect(typeof body.planCount).toBe('number');
    expect(typeof body.hasMcpSession).toBe('boolean');
    expect(typeof body.activeMcpSessionCount).toBe('number');
  });

  test('GET /api/onboarding-state without project param returns 400', async () => {
    const res = await h.client.raw('GET', '/api/onboarding-state');
    expect(res.status).toBe(400);
  });

  // --- Architecture Summary ---

  test('GET /api/architecture-summary returns summary after scan', async () => {
    const res = await h.client.raw('GET', '/api/architecture-summary');
    expect(res.ok).toBe(true);
    const body = await res.json();
    expect(body).toBeTruthy();
    expect(typeof body).toBe('object');
  });

  // --- File Content ---

  test('GET /api/file/content reads a source file', async () => {
    // Read one of the fixture files (monorepo structure)
    const filePath = path.join(h.fixture.projectPath, 'packages', 'shared', 'src', 'index.ts');
    const encodedPath = encodeURIComponent(filePath);
    const res = await h.client.raw('GET', `/api/file/content?path=${encodedPath}`);
    expect(res.ok).toBe(true);
    const body = await res.json();
    expect(typeof body.content).toBe('string');
    expect(body.content.length).toBeGreaterThan(0);
  });

  test('GET /api/file/content refuses a path outside every opened project', async () => {
    // Was asserted as 404. It is now 403, and that is the IMPROVEMENT rather
    // than a regression (Phase 19, findings 5 and 11): answering 404 for a
    // path outside the project tells the caller the file does not exist,
    // and 200 would tell them it does — an existence oracle for any path on
    // the machine. A uniform 403 for everything outside an opened project
    // discloses nothing either way.
    const outside = encodeURIComponent('/tmp/nonexistent-file-12345.ts');
    const res = await h.client.raw('GET', `/api/file/content?path=${outside}`);
    expect(res.status).toBe(403);

    // The same answer for a path outside a project that DOES exist — the
    // point is that the two are indistinguishable.
    const existsOutside = encodeURIComponent('/etc/hosts');
    const res2 = await h.client.raw('GET', `/api/file/content?path=${existsOutside}`);
    expect(
      res2.status,
      'an existing file outside the project must answer exactly as a missing one does',
    ).toBe(403);
  });

  test('GET /api/file/content returns 404 for a missing file INSIDE the project', async () => {
    // Inside an opened project, 404 is correct and leaks nothing the caller
    // could not already learn from the file tree.
    const missing = encodeURIComponent(`${h.fixture.projectPath}/does-not-exist-12345.ts`);
    const res = await h.client.raw('GET', `/api/file/content?path=${missing}`);
    expect(res.status).toBe(404);
  });

  test('GET /api/file/content returns 400 without path param', async () => {
    const res = await h.client.raw('GET', '/api/file/content');
    expect(res.status).toBe(400);
  });

  // --- Logs ---

  test('GET /api/logs/tail returns log content', async () => {
    const res = await h.client.raw('GET', '/api/logs/tail');
    expect(res.ok).toBe(true);
    const body = await res.json();
    expect(body).toHaveProperty('path');
    expect(body).toHaveProperty('content');
    expect(typeof body.content).toBe('string');
  });

  test('GET /api/logs/path returns log file location', async () => {
    const res = await h.client.raw('GET', '/api/logs/path');
    expect(res.ok).toBe(true);
    const body = await res.json();
    expect(body).toHaveProperty('logFile');
    expect(body).toHaveProperty('logDir');
    expect(typeof body.logFile).toBe('string');
  });

  // --- Updates ---

  test('GET /api/updates/status returns update state', async () => {
    const res = await h.client.raw('GET', '/api/updates/status');
    expect(res.ok).toBe(true);
    const body = await res.json();
    expect(body).toBeTruthy();
    expect(typeof body).toBe('object');
  });

  // --- Health / Status ---

  test('GET /api/health returns ok', async () => {
    const res = await h.client.raw('GET', '/api/health');
    expect(res.ok).toBe(true);
    const body = await res.json();
    expect(body.status).toBe('ok');
    expect(typeof body.timestamp).toBe('number');
  });

  test('GET /api/mcp/config returns connection config', async () => {
    const res = await h.client.raw('GET', '/api/mcp/config');
    expect(res.ok).toBe(true);
    const body = await res.json();
    expect(body).toBeTruthy();
    expect(typeof body).toBe('object');
  });

  test('GET /api/agent/status returns watcher state', async () => {
    const res = await h.client.raw('GET', '/api/agent/status');
    expect(res.ok).toBe(true);
    const body = await res.json();
    expect(body).toBeTruthy();
    expect(typeof body).toBe('object');
  });

  // --- Systems / FS ---

  test('GET /api/systems returns discovered systems', async () => {
    const encodedPath = encodeURIComponent(h.fixture.projectPath);
    const res = await h.client.raw('GET', `/api/systems?project=${encodedPath}`);
    expect(res.ok).toBe(true);
    const body = await res.json();
    expect(body).toHaveProperty('systems');
    expect(Array.isArray(body.systems)).toBe(true);
  });

  test('GET /api/fs/browse lists directories', async () => {
    const encodedPath = encodeURIComponent(h.fixture.projectPath);
    const res = await h.client.raw('GET', `/api/fs/browse?path=${encodedPath}`);
    expect(res.ok).toBe(true);
    const body = await res.json();
    expect(body).toHaveProperty('current');
    expect(body).toHaveProperty('parent');
    expect(body).toHaveProperty('dirs');
    expect(Array.isArray(body.dirs)).toBe(true);
  });
});
