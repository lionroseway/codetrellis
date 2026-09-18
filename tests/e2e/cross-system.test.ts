/**
 * Cross-system edge tests — proves the HTTP matcher actually pairs
 * files correctly, both at baseline and after the fixture changes.
 *
 * The fixture has six known pairings. Four are TS↔Python, between
 * `packages/web/src/api.ts` and the FastAPI routes:
 *
 *   web fetch                       python decorator
 *   ───────────────────────────     ─────────────────────────────
 *   fetch('/api/users')         ↔   @router.get('/api/users')
 *   fetch('/api/users', POST)   ↔   @router.post('/api/users')
 *   fetch('/api/orders')        ↔   @router.get('/api/orders')
 *   fetch('/api/orders', POST)  ↔   @router.post('/api/orders')
 *
 * Two more arrived with Go (Phase 20), and are covered in depth by
 * `go-support.test.ts`:
 *
 *   fetch('/api/billing/invoices')  ↔   chi r.Get('/invoices') under
 *                                       r.Route('/api/billing', …)
 *   Go http.NewRequest(…/api/orders) ↔  @router.get('/api/orders')
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

/**
 * This suite is about the HTTP matcher, so every count is scoped to HTTP
 * edges. Unscoped totals broke the moment SQL edges arrived (Phase 21)
 * and would break again on the next protocol; the intent was always
 * "the HTTP pairings are exactly these".
 */
const httpOnly = <T extends { protocol: string }>(edges: T[]): T[] =>
  edges.filter((e) => e.protocol === 'http');

/**
 * Every HTTP pairing the fixture should produce, sorted.
 *
 * Phase 28 added callsite extractors for Ruby, C#, Kotlin and Swift, so
 * the fixture now contains a chain that crosses four languages —
 * Swift → Kotlin → C# → Python — plus Ruby → Python, on top of the
 * original TS → Python and Go → Python pairings.
 *
 * The list is exact on purpose: this suite is the guard that says the
 * matcher pairs *these* and nothing else. The *counts* in the mutation
 * tests below are deliberately NOT hard-coded — see the note there.
 */
const EXPECTED_LABELS = [
  'DELETE /api/jobs/:id',       // Swift  → Kotlin
  'GET /api/billing/invoices',  // TS     → Go
  'GET /api/jobs',              // Swift  → Kotlin
  'GET /api/ledger',            // Kotlin → C#
  'GET /api/orders',            // TS     → Python
  'GET /api/orders',            // Go     → Python
  'GET /api/orders',            // C#     → Python
  'GET /api/users',             // TS     → Python
  'GET /api/users',             // Ruby   → Python
  'POST /api/orders',           // TS     → Python
  'POST /api/users',            // TS     → Python
  'POST /api/users',            // Ruby   → Python
];

test.describe('Cross-system HTTP matcher', () => {
  test.setTimeout(120_000);

  test('baseline scan reports exactly the expected HTTP edges', async () => {
    const h = await setupHarness('xs-baseline');
    try {
      await h.client.scanProject(h.fixture.projectPath);
      const resp = await h.client.getCrossSystem();
      const http = httpOnly(resp.edges);
      expect(http).toHaveLength(EXPECTED_LABELS.length);
      expect(resp.stats?.byProtocol?.http).toBe(EXPECTED_LABELS.length);

      for (const edge of http) {
        expect(edge.protocol).toMatch(/^http/i);
        expect(edge.confidence).toBeGreaterThan(0);
      }

      // Everything landing on the FastAPI service lands on a route
      // module — the callers are now TS, Go, Ruby and C#.
      const fromWeb = http.filter((e) =>
        e.targetRelative.startsWith('services/api/app/routes/'),
      );
      for (const edge of fromWeb) {
        expect(edge.targetRelative).toMatch(/^services\/api\/app\/routes\/(users|orders)\.py$/);
      }

      expect(http.map((e) => e.label).sort()).toEqual(EXPECTED_LABELS);
    } finally {
      await h.teardown();
    }
  });

  test('removing a Python route auto-refreshes and drops the matching edge', async () => {
    const h = await setupHarness('xs-remove-route');
    try {
      await h.client.scanProject(h.fixture.projectPath);
      const before = httpOnly(await h.client.getCrossSystemEdges());
      expect(before).toHaveLength(EXPECTED_LABELS.length);
      // Counted relative to the baseline rather than hard-coded. This
      // test has now broken three times purely because the fixture
      // grew — Phase 20 added two edges, Phase 28 six — and each time
      // the failure said nothing about the matcher, which is what the
      // test is for.
      const expectedAfter = before.length - 1;

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
          const edges = httpOnly(await h.client.getCrossSystemEdges());
          if (edges.length === expectedAfter && !edges.find((e) => e.label === 'POST /api/orders')) {
            return edges;
          }
          return null;
        },
        {
          timeoutMs: 15_000,
          intervalMs: 200,
          description: `cross-system edges to auto-refresh to exactly ${expectedAfter} (POST orders gone)`,
        },
      );

      expect(after).toHaveLength(expectedAfter);
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
      const before = httpOnly(await h.client.getCrossSystemEdges());
      expect(before).toHaveLength(EXPECTED_LABELS.length);
      const expectedAfter = before.length + 1;

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
      // before settling on the final 7-edge graph.
      const after = await waitFor(
        async () => {
          const edges = httpOnly(await h.client.getCrossSystemEdges());
          if (edges.length === expectedAfter && edges.find((e) => e.label === 'GET /api/products')) {
            return edges;
          }
          return null;
        },
        {
          timeoutMs: 15_000,
          intervalMs: 200,
          description: `cross-system edges to settle at ${expectedAfter} with the new GET /api/products`,
        },
      );

      expect(after).toHaveLength(expectedAfter);
      expect(after.find((e) => e.label === 'GET /api/products')).toBeDefined();
    } finally {
      await h.teardown();
    }
  });
});
