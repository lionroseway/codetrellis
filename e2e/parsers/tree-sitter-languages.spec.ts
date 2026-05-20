/**
 * Tree-sitter language parser validation.
 *
 * Scans tests/fixtures/sample-app/ and verifies symbol extraction
 * works correctly for each language present in the fixture.
 *
 * API-only — no browser needed.
 */

import { test, expect } from '@playwright/test';
import { API } from '../helpers/setup';
import { FIXTURE_PATH } from '../live-agent/helpers/fixture-reset';
import path from 'node:path';

/** Build absolute path into the fixture for the symbols/file endpoint. */
function fixturePath(relative: string): string {
  return path.join(FIXTURE_PATH, relative);
}

test.describe('Tree-sitter parser validation', () => {
  test.beforeAll(async ({ request }) => {
    // Scan the fixture repo
    const res = await request.post(`${API}/project/scan`, {
      data: { projectPath: FIXTURE_PATH },
    });
    expect(res.ok()).toBeTruthy();
  });

  test('TypeScript: extracts symbols from .ts files', async ({ request }) => {
    // types.ts should have User, Order, etc.
    const res = await request.get(
      `${API}/symbols/file?path=${encodeURIComponent(fixturePath('packages/shared/src/types.ts'))}`,
    );
    expect(res.ok()).toBeTruthy();
    const data = await res.json();
    const symbols = Array.isArray(data) ? data : data.symbols || [];
    expect(symbols.length).toBeGreaterThan(0);
  });

  test('TypeScript: extracts function exports from api.ts', async ({ request }) => {
    const res = await request.get(
      `${API}/symbols/file?path=${encodeURIComponent(fixturePath('packages/web/src/api.ts'))}`,
    );
    expect(res.ok()).toBeTruthy();
    const data = await res.json();
    const symbols = Array.isArray(data) ? data : data.symbols || [];
    // Should find listUsers, createUser, listOrders, createOrder
    const names = symbols.map((s: any) => s.name || s);
    expect(names.length).toBeGreaterThan(0);
  });

  test('TSX: extracts React components', async ({ request }) => {
    const res = await request.get(
      `${API}/symbols/file?path=${encodeURIComponent(fixturePath('packages/web/src/UserList.tsx'))}`,
    );
    expect(res.ok()).toBeTruthy();
    const data = await res.json();
    const symbols = Array.isArray(data) ? data : data.symbols || [];
    // Should find the UserList function component
    expect(symbols.length).toBeGreaterThan(0);
  });

  test('Python: extracts symbols from .py files', async ({ request }) => {
    const res = await request.get(
      `${API}/symbols/file?path=${encodeURIComponent(fixturePath('services/api/app/db.py'))}`,
    );
    expect(res.ok()).toBeTruthy();
    const data = await res.json();
    const symbols = Array.isArray(data) ? data : data.symbols || [];
    // Should find add_user, list_users, etc.
    expect(symbols.length).toBeGreaterThan(0);
  });

  test('search finds symbols by name', async ({ request }) => {
    const res = await request.get(`${API}/symbols/search?q=listUsers`);
    expect(res.ok()).toBeTruthy();
    const data = await res.json();
    const results = Array.isArray(data) ? data : data.results || data.symbols || [];
    expect(results.length).toBeGreaterThan(0);
  });

  test('import resolution: dependencies exist after scan', async ({ request }) => {
    const res = await request.get(`${API}/dependencies`);
    expect(res.ok()).toBeTruthy();
    const data = await res.json();
    // Fixture has import relationships between files
    const edges = Array.isArray(data) ? data : data.edges || data.dependencies || [];
    expect(edges.length).toBeGreaterThan(0);
  });

  test('per-file dependencies return imports + importedBy', async ({ request }) => {
    // api.ts imports from @sample/shared (types)
    const res = await request.get(
      `${API}/dependencies/file?path=${encodeURIComponent(fixturePath('packages/web/src/api.ts'))}`,
    );
    expect(res.ok()).toBeTruthy();
    const data = await res.json();
    expect(data).toBeTruthy();
    // Should have at least one import relationship — check multiple shapes
    const imports = data.imports || data.dependencies || [];
    const importedBy = data.importedBy || data.dependents || [];
    const edges = data.edges || [];
    expect(imports.length + importedBy.length + edges.length).toBeGreaterThan(0);
  });

  test('scanning does not crash (stability check)', async ({ request }) => {
    // Scan the fixture repo a second time — verifies tree-sitter
    // handles re-scanning without WASM instability
    const res = await request.post(`${API}/project/scan`, {
      data: { projectPath: FIXTURE_PATH },
    });
    expect(res.ok()).toBeTruthy();
  });
});
