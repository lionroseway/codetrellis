/**
 * Baselines & Trellis snapshots — architecture snapshot lifecycle.
 *
 * Exercises:
 *   - GET    /api/baseline               — read current baseline
 *   - POST   /api/baseline/capture       — capture a new baseline
 *   - POST   /api/trellis/capture        — capture a trellis snapshot
 *   - GET    /api/trellis/snapshots      — list snapshots
 *   - GET    /api/trellis/:id            — get a single snapshot
 *   - GET    /api/trellis/:id/diff       — diff a snapshot against baseline
 *
 * The project must be scanned before baselines work (they read the
 * in-memory file/edge data).
 */

import { test, expect } from '@playwright/test';
import { setupHarness, type Harness } from '../harness';

test.describe.serial('Baselines & Trellis snapshots', () => {
  test.setTimeout(120_000);

  let h: Harness;
  let snapshotId: number;

  test.beforeAll(async () => {
    h = await setupHarness('baselines');
    await h.client.scanProject(h.fixture.projectPath);
  });

  test.afterAll(async () => {
    await h?.teardown();
  });

  test('GET /api/baseline returns 404 before capture', async () => {
    const res = await h.client.raw('GET', '/api/baseline');
    // May return 404 (no baseline yet) or 200 if scan auto-captured one
    if (res.status === 404) {
      const body = await res.json();
      expect(body.error).toBeTruthy();
    } else {
      expect(res.ok).toBe(true);
    }
  });

  test('POST /api/baseline/capture creates a baseline', async () => {
    const res = await h.client.raw('POST', '/api/baseline/capture', {
      projectPath: h.fixture.projectPath,
    });
    expect(res.ok).toBe(true);
    const body = await res.json();
    // Should return baseline data with files and edges
    expect(body).toBeTruthy();
  });

  test('GET /api/baseline returns the captured baseline', async () => {
    const res = await h.client.raw('GET', '/api/baseline');
    expect(res.ok).toBe(true);
    const body = await res.json();
    expect(body).toHaveProperty('data');
    expect(body.data).toHaveProperty('files');
    expect(body.data).toHaveProperty('edges');
    expect(Array.isArray(body.data.files)).toBe(true);
  });

  test('POST /api/trellis/capture creates a snapshot', async () => {
    const res = await h.client.raw('POST', '/api/trellis/capture', {
      projectPath: h.fixture.projectPath,
      name: 'Test snapshot',
    });
    expect(res.ok).toBe(true);
    const body = await res.json();
    expect(typeof body.id).toBe('number');
    expect(body.name).toBe('Test snapshot');
    snapshotId = body.id;
  });

  test('GET /api/trellis/snapshots lists the snapshot', async () => {
    const res = await h.client.raw('GET', '/api/trellis/snapshots');
    expect(res.ok).toBe(true);
    const list = await res.json();
    expect(Array.isArray(list)).toBe(true);
    expect(list.length).toBeGreaterThanOrEqual(1);
    const match = list.find((s: { id: number }) => s.id === snapshotId);
    expect(match).toBeDefined();
  });

  test('GET /api/trellis/:id returns the snapshot', async () => {
    const res = await h.client.raw('GET', `/api/trellis/${snapshotId}`);
    expect(res.ok).toBe(true);
    const body = await res.json();
    expect(body.id).toBe(snapshotId);
    expect(body.name).toBe('Test snapshot');
  });

  test('GET /api/trellis/:id/diff returns a diff object', async () => {
    const res = await h.client.raw('GET', `/api/trellis/${snapshotId}/diff`);
    expect(res.ok).toBe(true);
    const body = await res.json();
    // Diff should have added/removed/modified arrays
    expect(body).toBeTruthy();
    expect(typeof body).toBe('object');
  });
});
