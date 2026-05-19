/**
 * Graph analysis API coverage — symbols, dependencies, cross-system,
 * file content, architecture summary.
 */

import { test, expect } from '@playwright/test';
import { API, PROJECT_PATH } from '../helpers/setup';

test.describe('Graph analysis APIs', () => {
  // Ensure project is scanned before running these
  test.beforeAll(async ({ request }) => {
    await request.post(`${API}/project/scan`, {
      data: { projectPath: PROJECT_PATH },
    });
  });

  test('GET /api/symbols/search returns results for known symbol', async ({ request }) => {
    const res = await request.get(`${API}/symbols/search?q=useGraphStore`);
    expect(res.ok()).toBeTruthy();
    const data = await res.json();
    expect(Array.isArray(data)).toBe(true);
  });

  test('GET /api/symbols/file returns symbols for a source file', async ({ request }) => {
    const filePath = `${PROJECT_PATH}/src/backend/server.ts`;
    const res = await request.get(`${API}/symbols/file?path=${encodeURIComponent(filePath)}`);
    expect(res.ok()).toBeTruthy();
    const symbols = await res.json();
    expect(Array.isArray(symbols)).toBe(true);
  });

  test('GET /api/dependencies returns edge array', async ({ request }) => {
    const res = await request.get(`${API}/dependencies`);
    expect(res.ok()).toBeTruthy();
    const edges = await res.json();
    expect(Array.isArray(edges)).toBe(true);
    expect(edges.length).toBeGreaterThan(0);
  });

  test('GET /api/dependencies/file returns per-file deps', async ({ request }) => {
    const res = await request.get(
      `${API}/dependencies/file?path=${encodeURIComponent('src/backend/server.ts')}`,
    );
    expect(res.status()).toBeLessThan(500);
    const data = await res.json();
    expect(typeof data).toBe('object');
  });

  test('GET /api/cross-system returns cross-system edges', async ({ request }) => {
    const res = await request.get(`${API}/cross-system`);
    expect(res.ok()).toBeTruthy();
    const data = await res.json();
    expect(typeof data).toBe('object');
  });

  test('GET /api/file/content returns file text', async ({ request }) => {
    const filePath = `${PROJECT_PATH}/package.json`;
    const res = await request.get(`${API}/file/content?path=${encodeURIComponent(filePath)}`);
    expect(res.ok()).toBeTruthy();
    const data = await res.json();
    expect(data.content || data.text || typeof data === 'string').toBeTruthy();
  });

  test('GET /api/architecture-summary returns summary', async ({ request }) => {
    const res = await request.get(`${API}/architecture-summary`);
    expect(res.ok()).toBeTruthy();
    const data = await res.json();
    expect(typeof data).toBe('object');
  });

  test('GET /api/diff returns change data', async ({ request }) => {
    const res = await request.get(`${API}/diff?project=${encodeURIComponent(PROJECT_PATH)}`);
    expect(res.status()).toBeLessThan(500);
    const data = await res.json();
    expect(typeof data).toBe('object');
  });

  test('GET /api/stats returns database counts', async ({ request }) => {
    const res = await request.get(`${API}/stats`);
    expect(res.ok()).toBeTruthy();
    const data = await res.json();
    expect(typeof data).toBe('object');
  });

  test('GET /api/auto-detect returns detected project info', async ({ request }) => {
    const res = await request.get(`${API}/auto-detect`);
    expect(res.status()).toBeLessThan(500);
  });

  test('GET /api/systems returns discovered systems', async ({ request }) => {
    const res = await request.get(`${API}/systems?project=${encodeURIComponent(PROJECT_PATH)}`);
    expect(res.ok()).toBeTruthy();
    const data = await res.json();
    expect(data.systems || Array.isArray(data)).toBeTruthy();
  });
});
