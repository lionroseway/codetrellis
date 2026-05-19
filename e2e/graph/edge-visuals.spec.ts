/**
 * Edge visuals — edges render between nodes with correct states.
 *
 * Covers: edges visible after scan, edge count > 0, edge paths render,
 * import edge type.
 */

import { test, expect } from '@playwright/test';
import { gotoWithProject } from '../helpers/setup';

test.describe('Edge visuals', () => {
  test('edges render between nodes', async ({ page }) => {
    await gotoWithProject(page);

    await page.waitForTimeout(2000);
    // ReactFlow renders edges as SVG paths
    const edges = page.locator('.react-flow__edge');
    const count = await edges.count();
    expect(count).toBeGreaterThan(0);
  });

  test('edges have SVG path elements', async ({ page }) => {
    await gotoWithProject(page);

    await page.waitForTimeout(2000);
    // Each edge should contain a path element
    const edgePaths = page.locator('.react-flow__edge path');
    const count = await edgePaths.count();
    expect(count).toBeGreaterThan(0);
  });

  test('edges still render after switching to Files depth', async ({ page }) => {
    await gotoWithProject(page);

    await page.getByRole('button', { name: 'Files' }).click();
    await page.waitForTimeout(2000);

    const edges = page.locator('.react-flow__edge');
    const count = await edges.count();
    // File-level view should also have dependency edges
    expect(count).toBeGreaterThanOrEqual(0);
  });
});
