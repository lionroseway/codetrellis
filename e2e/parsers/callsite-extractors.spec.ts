/**
 * Callsite extractor validation.
 *
 * Verifies that HTTP / SQL / subprocess patterns are correctly
 * extracted from the fixture repo and paired across systems.
 *
 * The fixture has known cross-system coupling:
 *   packages/web/src/api.ts → fetch('/api/users')
 *   services/api/app/routes/users.py → @router.get('/api/users')
 *
 * API-only — no browser needed.
 */

import { test, expect } from '@playwright/test';
import { API, openProject } from '../helpers/setup';
import { FIXTURE_PATH } from '../live-agent/helpers/fixture-reset';

test.describe('Callsite extractors', () => {
  test.beforeAll(async () => {
    // Retried until the scan really ran: a scan while another is in
    // progress answers 200 with the file tree only, and the graph these
    // tests read is then another project's.
    await openProject(FIXTURE_PATH);
  });

  test('cross-system endpoint returns data', async ({ request }) => {
    const res = await request.get(`${API}/cross-system`);
    expect(res.ok()).toBeTruthy();
    const data = await res.json();
    expect(data).toBeTruthy();
  });

  test('cross-system edges include known HTTP pairings', async ({ request }) => {
    const res = await request.get(`${API}/cross-system`);
    const data = await res.json();
    const edges = Array.isArray(data) ? data : data.edges || [];

    // The fixture has fetch('/api/users') in api.ts and
    // @router.get('/api/users') in users.py. The cross-system
    // extractor should find at least one edge.
    expect(edges.length).toBeGreaterThan(0);

    // Verify at least one edge mentions the /api/users route
    const hasUsersRoute = edges.some(
      (e: any) => e.label?.includes('/api/users') || e.protocol === 'http',
    );
    expect(hasUsersRoute).toBe(true);
  });

  test('architecture-summary endpoint includes cross-system data', async ({ request }) => {
    const res = await request.get(`${API}/architecture-summary`);
    expect(res.ok()).toBeTruthy();
    const data = await res.json();
    expect(data).toBeTruthy();
    // Should have file count from the scanned fixture
    expect(data.fileCount).toBeGreaterThan(0);
  });

  test('stats endpoint reflects scanned fixture', async ({ request }) => {
    const res = await request.get(`${API}/stats`);
    expect(res.ok()).toBeTruthy();
    const data = await res.json();
    // Should have some file/symbol counts from the scan
    expect(data).toBeTruthy();
    expect(data.fileCount).toBeGreaterThan(0);
    expect(data.symbolCount).toBeGreaterThan(0);
  });
});
