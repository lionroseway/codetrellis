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
 *  2. Removing a Python route auto-refreshes (no manual rescan) and
 *     drops the matching edge.
 *  3. Adding a new fetch + matching route auto-refreshes and adds
 *     an edge.
 *
 * History: tests 2 + 3 used to call `scanProject()` again after
 * each mutation because the file-watcher didn't call
 * `recomputeCrossSystemEdges()`. Fixed Apr 28 — the watcher now
 * schedules a debounced recompute on every `change` / `add` /
 * `unlink`, so cross-system edges stay current with the source.
 */

import { test, expect } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';
import { setupHarness, waitFor, sleep } from '../harness';

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

  test('removing a Python route auto-refreshes and drops the matching edge', async () => {
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

      // Brief settle: chokidar's awaitWriteFinish (300 ms) + the
      // file-watcher's own recompute debounce (500 ms) sometimes
      // produce two recompute cycles when the OS fires duplicate
      // change events. A 1s settle lets the second cycle finish
      // before we start polling, so we don't catch a transient
      // mid-recompute state and treat it as final.
      await sleep(1000);

      // No manual re-scan — the file-watcher's debounced recompute
      // should fire automatically. Wait for the EXACT expected
      // state (3 edges, POST /api/orders gone) so we're robust to
      // transient mid-refresh values.
      const after = await waitFor(
        async () => {
          const edges = await h.client.getCrossSystemEdges();
          if (edges.length === 3 && !edges.find((e) => e.label === 'POST /api/orders')) {
            return edges;
          }
          return null;
        },
        {
          timeoutMs: 15_000,
          intervalMs: 200,
          description: 'cross-system edges to auto-refresh to exactly 3 (POST orders gone)',
        },
      );

      expect(after).toHaveLength(3);
      expect(after.find((e) => e.label === 'POST /api/orders')).toBeUndefined();
      // The GET /api/orders edge should remain.
      expect(after.find((e) => e.label === 'GET /api/orders')).toBeDefined();
    } finally {
      await h.teardown();
    }
  });

  test('adding a new fetch + matching route auto-refreshes and adds an edge', async () => {
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

      // Brief settle for the same chokidar / debounce reason as the
      // remove-route test above.
      await sleep(1000);

      // No manual re-scan — wait for the EXACT expected state. The
      // recompute can pass through transient mid-refresh values
      // before settling on the final 5-edge graph.
      const after = await waitFor(
        async () => {
          const edges = await h.client.getCrossSystemEdges();
          if (edges.length === 5 && edges.find((e) => e.label === 'GET /api/products')) {
            return edges;
          }
          return null;
        },
        {
          timeoutMs: 15_000,
          intervalMs: 200,
          description: 'cross-system edges to settle at 5 with the new GET /api/products',
        },
      );

      expect(after).toHaveLength(5);
      expect(after.find((e) => e.label === 'GET /api/products')).toBeDefined();
    } finally {
      await h.teardown();
    }
  });
});
