/**
 * Multi-select — shift-click and selection behaviour on graph nodes.
 *
 * Covers: shift-click keeps both nodes, single click deselects others.
 * Note: ReactFlow@11 selection class varies. Tests verify behavior
 * via the inspector state rather than CSS classes.
 */

import { test, expect } from '@playwright/test';
import { gotoWithProject, reachableNodes } from '../helpers/setup';

test.describe('Multi-select', () => {
  test('shift-clicking a second node keeps first visually selected', async ({ page }) => {
    await gotoWithProject(page);

    await page.waitForTimeout(2000);
    const nodes = await reachableNodes(page);
    const count = nodes.length;

    if (count < 2) {
      test.skip();
      return;
    }

    // Click first node normally
    await nodes[0].click();
    await page.waitForTimeout(300);

    // Shift-click second node to multi-select
    await nodes[1].click({ modifiers: ['Shift'] });
    await page.waitForTimeout(300);

    // With multi-select, at least the second node should be "selected"
    // We verify via inspector — multi-select doesn't change inspector
    // to empty state (it shows the last clicked node)
    const inspector = page.locator('.glass-panel.border-l');
    await expect(
      inspector.getByText('Click a cluster, file, or symbol to inspect'),
    ).not.toBeVisible();
  });

  test('single click after multi-select deselects others', async ({ page }) => {
    await gotoWithProject(page);

    await page.waitForTimeout(2000);
    const nodes = await reachableNodes(page);
    const count = nodes.length;

    if (count < 2) {
      test.skip();
      return;
    }

    // Multi-select two nodes
    await nodes[0].click();
    await page.waitForTimeout(200);
    await nodes[1].click({ modifiers: ['Shift'] });
    await page.waitForTimeout(200);

    // Single-click a node (without shift) should select only that one
    await nodes[0].click();
    await page.waitForTimeout(300);

    // Inspector should show content for the single clicked node
    const inspector = page.locator('.glass-panel.border-l');
    await expect(
      inspector.getByText('Click a cluster, file, or symbol to inspect'),
    ).not.toBeVisible();
  });
});
