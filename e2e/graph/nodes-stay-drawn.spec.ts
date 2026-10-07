/**
 * Graph nodes stay drawn while what the canvas shows changes.
 *
 * The canvas rebuilds every node object when its overlays change: selecting a
 * node, a plan's highlight, work counts, collisions. React Flow 12 draws a node
 * with no `measured` size as `visibility: hidden` until it measures it again,
 * and the rebuild kept only each node's position. So every such change hid the
 * whole graph for a frame, and two in one batch could leave it hidden: the
 * re-measure never came, because no element changed size (node-click on #226:
 * 14 nodes in the DOM, none visible, none in the minimap).
 *
 * Here, once the graph is up, every node is watched, and selecting nodes and
 * clearing the selection must never hide one.
 *
 * And the edges between them stay drawn: React Flow draws an edge from its
 * nodes' handle positions, and a node it holds as measured whose handles it
 * has lost is never measured again by itself. CI's serial run drew 21 files
 * and none of their 25 imports like that (#387), so the canvas measures such
 * a node again (`RemeasureHandles`).
 */

import { test, expect } from '@playwright/test';
import { gotoWithProject, reachableNodes, FIXTURE_PATH } from '../helpers/setup';

test('selecting and clearing never hides a graph node', async ({ page }) => {
  await gotoWithProject(page, { projectPath: FIXTURE_PATH });
  const nodes = await reachableNodes(page);
  expect(nodes.length).toBeGreaterThanOrEqual(2);

  // Every time any node's style says hidden, from now on.
  await page.evaluate(() => {
    const w = window as unknown as { __hiddenNodes: string[] };
    w.__hiddenNodes = [];
    new MutationObserver((records) => {
      for (const r of records) {
        const el = r.target as HTMLElement;
        if (el.classList?.contains('react-flow__node') && el.style.visibility === 'hidden') w.__hiddenNodes.push(el.dataset.id ?? '?');
      }
    }).observe(document.querySelector('.react-flow')!, { attributes: true, attributeFilter: ['style'], subtree: true });
  });

  await nodes[0].click();
  await page.waitForTimeout(300);
  await nodes[1].click();
  await page.waitForTimeout(300);
  await page.keyboard.press('Escape');
  await page.waitForTimeout(500);

  const hidden = await page.evaluate(() => (window as unknown as { __hiddenNodes: string[] }).__hiddenNodes);
  expect(hidden, `nodes hidden while the selection changed: ${[...new Set(hidden)].join(', ')}`).toEqual([]);
  await expect(page.locator('.react-flow__minimap-node')).toHaveCount(await page.locator('.react-flow__node').count());
});

test('a node React Flow has lost the handles of is measured again, and its edges drawn', async ({ page }) => {
  await gotoWithProject(page, { projectPath: FIXTURE_PATH });
  await page.getByRole('button', { name: 'Files', exact: true }).click();
  await reachableNodes(page);
  const edges = page.locator('.react-flow__edge');
  await expect.poll(() => edges.count(), { timeout: 20_000 }).toBeGreaterThan(0);

  // The state CI caught: every node measured, none with handle positions,
  // and no report coming from the nodes' ResizeObserver. Clearing the handles
  // alone makes React Flow observe each node again, and that first report
  // repairs it, so the observer is held quiet while it happens.
  const wiped = await page.evaluate(async () => {
    const observe = ResizeObserver.prototype.observe;
    ResizeObserver.prototype.observe = function quiet() { /* the report that never came */ };
    try {
      const el = document.querySelector('.react-flow__renderer') as (HTMLElement & Record<string, unknown>) | null;
      const key = el && Object.keys(el).find((k) => k.startsWith('__reactFiber$'));
      type Internal = { measured?: { width?: number }; internals: Record<string, unknown> };
      type Store = { getState: () => { nodeLookup: Map<string, Internal> }; setState: (s: object) => void };
      type Fiber = { return?: Fiber; memoizedProps?: { value?: Partial<Store> } };
      let f = (key ? el[key] : null) as Fiber | null;
      while (f && !f.memoizedProps?.value?.getState) f = f.return ?? null;
      const store = f?.memoizedProps?.value as Store | undefined;
      if (!store) return 0;
      const { nodeLookup } = store.getState();
      for (const [id, node] of nodeLookup) nodeLookup.set(id, { ...node, internals: { ...node.internals, handleBounds: undefined } });
      store.setState({});
      await new Promise((r) => setTimeout(r, 1000));
      return [...nodeLookup.values()].filter((n) => n.measured?.width).length;
    } finally {
      ResizeObserver.prototype.observe = observe;
    }
  });
  expect(wiped).toBeGreaterThan(0);

  await expect.poll(() => edges.count(), { timeout: 5_000 }).toBeGreaterThan(0);
});
