/**
 * Baseline & Trellis snapshot API coverage — capture, read, diff.
 */

import { test, expect } from '@playwright/test';
import { API, PROJECT_PATH } from '../helpers/setup';

test.describe('Baseline & snapshot APIs', () => {
  test.beforeAll(async ({ request }) => {
    await request.post(`${API}/project/scan`, {
      data: { projectPath: PROJECT_PATH },
    });
  });

  test('GET /api/baseline returns snapshot or empty', async ({ request }) => {
    const res = await request.get(`${API}/baseline`);
    expect(res.ok()).toBeTruthy();
    const data = await res.json();
    expect(typeof data).toBe('object');
  });

  test('POST /api/baseline/capture creates a baseline snapshot', async ({ request }) => {
    const res = await request.post(`${API}/baseline/capture`, {
      data: { projectPath: PROJECT_PATH },
    });
    expect(res.ok()).toBeTruthy();
    const snapshot = await res.json();
    expect(snapshot.id || snapshot.name).toBeTruthy();
  });

  test('POST /api/trellis/capture creates a named snapshot', async ({ request }) => {
    const res = await request.post(`${API}/trellis/capture`, {
      data: { projectPath: PROJECT_PATH, name: 'E2E test snapshot' },
    });
    expect(res.ok()).toBeTruthy();
    const snapshot = await res.json();
    expect(snapshot.id).toBeTruthy();
  });

  test('GET /api/trellis/snapshots lists snapshots', async ({ request }) => {
    const res = await request.get(`${API}/trellis/snapshots`);
    expect(res.ok()).toBeTruthy();
    const data = await res.json();
    expect(Array.isArray(data)).toBe(true);
  });

  test('GET /api/trellis/:id returns snapshot data', async ({ request }) => {
    // First capture one
    const captureRes = await request.post(`${API}/trellis/capture`, {
      data: { projectPath: PROJECT_PATH, name: 'E2E snapshot read test' },
    });
    const snapshot = await captureRes.json();

    const res = await request.get(`${API}/trellis/${snapshot.id}`);
    expect(res.ok()).toBeTruthy();
    const data = await res.json();
    expect(data.id).toBe(snapshot.id);
    expect(data.data || data.edges || data.files).toBeTruthy();
  });

  test('GET /api/trellis/:id/diff returns diff against live', async ({ request }) => {
    const captureRes = await request.post(`${API}/trellis/capture`, {
      data: { projectPath: PROJECT_PATH, name: 'E2E snapshot diff test' },
    });
    const snapshot = await captureRes.json();

    const res = await request.get(`${API}/trellis/${snapshot.id}/diff`);
    expect(res.ok()).toBeTruthy();
    const diff = await res.json();
    expect(typeof diff).toBe('object');
  });
});
