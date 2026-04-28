/**
 * Cross-system edge tests — proves the TS↔Python HTTP matcher
 * actually pairs files correctly, both at baseline and after the
 * fixture changes.
 *
 * The fixture has four known pairings between
 * `packages/web/src/api.ts` and the FastAPI routes:
 *
 *   web fetch                       python decorator
 *   ───────────────────────────     ─────────────────────────────
 *   fetch('/api/users')         ↔   @router.get('/api/users')
 *   fetch('/api/users', POST)   ↔   @router.post('/api/users')
 *   fetch('/api/orders')        ↔   @router.get('/api/orders')
 *   fetch('/api/orders', POST)  ↔   @router.post('/api/orders')
 *
 * Tests:
 *  1. Baseline scan reports exactly 4 cross-system edges with the
 *     expected labels.
 *  2. Removing a Python route + re-scan drops the matching edge.
 *  3. Adding a new fetch + matching route + re-scan adds an edge.
 *
 * **Known gap surfaced by these tests** — the cross-system matcher
 * only runs inside `/api/project/scan`. The file watcher's `change`
 * handler re-parses but doesn't call `recomputeCrossSystemEdges()`,
 * so cross-system edges go stale until the user rescans manually.
 * The tests work around this by triggering a fresh scan after
 * mutation; the gap itself is logged in TRACKER §7.
 */

import { test, expect } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';
import { setupHarness } from '../harness';

test.describe('Cross-system HTTP matcher', () => {
  test.setTimeout(120_000);

  test('baseline scan reports exactly 4 HTTP edges with correct labels', async () => {
    const h = await setupHarness('xs-baseline');
    try {
      await h.client.scanProject(h.fixture.projectPath);
      const resp = await h.client.getCrossSystem();
      expect(resp.edges).toHaveLength(4);
      expect(resp.stats?.edgeCount).toBe(4);
      expect(resp.stats?.byProtocol?.http).toBe(4);

      // Every edge should be HTTP, originate at api.ts, and target a
      // route file under services/api.
      for (const edge of resp.edges) {
        expect(edge.protocol).toMatch(/^http/i);
        expect(edge.sourceRelative).toContain('packages/web/src/api.ts');
        expect(edge.targetRelative).toMatch(/^services\/api\/app\/routes\/(users|orders)\.py$/);
        expect(edge.confidence).toBeGreaterThan(0);
      }

      // Labels should cover all four method+route pairings exactly once.
      const labels = new Set(resp.edges.map((e) => e.label));
      expect(labels).toEqual(
        new Set(['GET /api/users', 'POST /api/users', 'GET /api/orders', 'POST /api/orders']),
      );
    } finally {
      await h.teardown();
    }
  });

  test('removing a Python route + re-scan drops the matching edge', async () => {
    const h = await setupHarness('xs-remove-route');
    try {
      await h.client.scanProject(h.fixture.projectPath);
      const before = await h.client.getCrossSystemEdges();
      expect(before).toHaveLength(4);

      // Strip the POST /api/orders decorator + handler from
      // services/api/app/routes/orders.py — leaves the GET intact.
      const ordersPy = path.join(
        h.fixture.projectPath,
        'services/api/app/routes/orders.py',
      );
      const original = fs.readFileSync(ordersPy, 'utf-8');
      const edited = original.replace(
        /\n@router\.post\("\/api\/orders"\)\ndef post_order\([^)]*\) -> Order:\n\s+return add_order\([^)]*\)\n/,
        '\n',
      );
      expect(edited.length).toBeLessThan(original.length);
      expect(edited).not.toContain('@router.post("/api/orders")');
      fs.writeFileSync(ordersPy, edited, 'utf-8');

      // Re-scan to refresh the cross-system matcher (gap: it doesn't
      // re-run on file-change today).
      await h.client.scanProject(h.fixture.projectPath);
      const after = await h.client.getCrossSystemEdges();

      expect(after).toHaveLength(3);
      expect(after.find((e) => e.label === 'POST /api/orders')).toBeUndefined();
      // The GET /api/orders edge should remain.
      expect(after.find((e) => e.label === 'GET /api/orders')).toBeDefined();
    } finally {
      await h.teardown();
    }
  });

  test('adding a new fetch + matching route + re-scan adds an edge', async () => {
    const h = await setupHarness('xs-add-edge');
    try {
      await h.client.scanProject(h.fixture.projectPath);
      const before = await h.client.getCrossSystemEdges();
      expect(before).toHaveLength(4);

      // Add a new fetch on the TS side.
      const apiTs = path.join(h.fixture.projectPath, 'packages/web/src/api.ts');
      fs.appendFileSync(
        apiTs,
        `
export async function listProducts() {
  const res = await fetch('/api/products');
  if (!res.ok) throw new Error('listProducts failed: ' + res.status);
  return res.json();
}
`,
        'utf-8',
      );

      // Add the matching route on the Python side. We append to the
      // existing orders.py to avoid scaffolding a whole new module.
      const ordersPy = path.join(
        h.fixture.projectPath,
        'services/api/app/routes/orders.py',
      );
      fs.appendFileSync(
        ordersPy,
        `
@router.get("/api/products")
def get_products() -> list[Order]:
    return []
`,
        'utf-8',
      );

      await h.client.scanProject(h.fixture.projectPath);
      const after = await h.client.getCrossSystemEdges();

      expect(after).toHaveLength(5);
      expect(after.find((e) => e.label === 'GET /api/products')).toBeDefined();
    } finally {
      await h.teardown();
    }
  });
});
