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
