/**
 * Edge visuals — edges render between nodes with correct states.
 *
 * Covers: edges visible after scan, edge count > 0, edge paths render,
 * import edge type.
 *
 * Each test polls for what it waits on rather than counting after a fixed
 * wait, which ran out of time on a slow runner (#212).
 */

import { test, expect } from '@playwright/test';
import { gotoWithProject } from '../helpers/setup';

test.describe('Edge visuals', () => {
  test('edges render between nodes', async ({ page }) => {
    await gotoWithProject(page);

    // ReactFlow renders edges as SVG paths
    await expect.poll(() => page.locator('.react-flow__edge').count(), { timeout: 15_000 }).toBeGreaterThan(0);
  });

  test('edges have SVG path elements', async ({ page }) => {
    await gotoWithProject(page);

    // Each edge should contain a path element
    await expect.poll(() => page.locator('.react-flow__edge path').count(), { timeout: 15_000 }).toBeGreaterThan(0);
  });

  test('edges still render after switching to Files depth', async ({ page }) => {
    await gotoWithProject(page);

    // Exact: the TopBar's workstream chips say "N files changed", and in a
    // checkout with branches a loose match finds them too.
    await page.getByRole('button', { name: 'Files', exact: true }).click();

    // File-level view should also have dependency edges
    await expect.poll(() => page.locator('.react-flow__edge').count(), { timeout: 15_000 }).toBeGreaterThan(0);
  });
});
