/**
 * Git API coverage — head, branch-tip, onboarding state, recent
 * projects, filesystem browse, logs.
 */

import { test, expect } from '@playwright/test';
import { API, PROJECT_PATH } from '../helpers/setup';

test.describe('Git advanced APIs', () => {
  test('GET /api/git/head returns commit hash', async ({ request }) => {
    const res = await request.get(`${API}/git/head?path=${encodeURIComponent(PROJECT_PATH)}`);
    expect(res.ok()).toBeTruthy();
    const data = await res.json();
    expect(data.commitHash === null || typeof data.commitHash === 'string').toBe(true);
  });

  test('GET /api/git/branch-tip resolves branch to commit', async ({ request }) => {
    const res = await request.get(
      `${API}/git/branch-tip?path=${encodeURIComponent(PROJECT_PATH)}&branch=main`,
    );
    // May fail if branch doesn't exist — that's 400, not 500
    expect(res.status()).toBeLessThan(500);
  });

  test('GET /api/onboarding-state returns state object', async ({ request }) => {
    const res = await request.get(
      `${API}/onboarding-state?project=${encodeURIComponent(PROJECT_PATH)}`,
    );
    expect(res.ok()).toBeTruthy();
    const data = await res.json();
    expect(typeof data).toBe('object');
    expect(typeof data.hasPlan).toBe('boolean');
  });

  test('GET /api/recent-projects returns projects wrapper', async ({ request }) => {
    const res = await request.get(`${API}/recent-projects`);
    expect(res.ok()).toBeTruthy();
    const data = await res.json();
    expect(data.projects).toBeDefined();
    expect(Array.isArray(data.projects)).toBe(true);
  });

  test('GET /api/fs/browse returns directory listing', async ({ request }) => {
    const res = await request.get(`${API}/fs/browse?path=${encodeURIComponent(PROJECT_PATH)}`);
    expect(res.ok()).toBeTruthy();
    const data = await res.json();
    expect(data.current).toBeTruthy();
    expect(Array.isArray(data.dirs)).toBe(true);
  });

  test('GET /api/logs/tail returns log content', async ({ request }) => {
    const res = await request.get(`${API}/logs/tail?maxBytes=1024`);
    expect(res.ok()).toBeTruthy();
    const data = await res.json();
    expect(data.path || data.content !== undefined).toBeTruthy();
  });

  test('GET /api/logs/path returns log file location', async ({ request }) => {
    const res = await request.get(`${API}/logs/path`);
    expect(res.ok()).toBeTruthy();
    const data = await res.json();
    expect(data.logFile || data.logDir).toBeTruthy();
  });

  test('POST /api/updates/check does not crash', async ({ request }) => {
    const res = await request.post(`${API}/updates/check`);
    // May return 200 or error depending on network — shouldn't 500
    expect(res.status()).toBeLessThan(500);
  });

  test('GET /api/build-info returns version data', async ({ request }) => {
    const res = await request.get(`${API}/build-info`);
    expect(res.ok()).toBeTruthy();
    const data = await res.json();
    expect(typeof data).toBe('object');
  });
});
