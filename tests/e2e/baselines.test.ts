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
import fs from 'node:fs';
import path from 'node:path';
import { setupHarness, waitFor, type Harness } from '../harness';

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
    expect(body.gitBranch).toBe('main');
  });

  test('GET /api/trellis/:id/diff is empty at first, then reports work done since the snapshot', async () => {
    type TDiff = { addedFiles: string[]; modifiedFiles: string[]; addedEdges: Array<{ source: string; target: string }> };
    const first = (await (await h.client.raw('GET', `/api/trellis/${snapshotId}/diff`)).json()) as TDiff;
    expect(first.addedFiles).toEqual([]);
    expect(first.modifiedFiles).toEqual([]);

    // Work lands after the snapshot. No rescan: the watcher keeps the
    // live side current (Phase 32 0.4b, bug 20).
    const root = h.fixture.projectPath;
    fs.writeFileSync(path.join(root, 'packages/web/src/SinceSnapshot.ts'), "import { listUsers } from './api';\nexport const s = listUsers;\n");
    const diff = await waitFor(async () => {
      const d = (await (await h.client.raw('GET', `/api/trellis/${snapshotId}/diff`)).json()) as TDiff;
      return d.addedEdges.length > 0 ? d : null;
    }, { timeoutMs: 15_000, description: 'the new file and its edge to appear in the snapshot diff' });
    expect(diff.addedFiles).toContain('packages/web/src/SinceSnapshot.ts');
    expect(diff.addedEdges).toContainEqual({ source: 'packages/web/src/SinceSnapshot.ts', target: 'packages/web/src/api.ts' });

    const missing = await h.client.raw('GET', '/api/trellis/999999/diff');
    expect(missing.status).toBe(404);
  });
});
