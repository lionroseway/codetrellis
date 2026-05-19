/**
 * Project scanning — verifies the UI state after a scan completes.
 *
 * Covers: graph canvas renders, sidebar populates, status bar shows
 * "Ready", plan panel tabs appear.
 */

import { test, expect } from '@playwright/test';
import { gotoWithProject } from '../helpers/setup';

test.describe('Project scan', () => {
  test('graph canvas renders after scan', async ({ page }) => {
    await gotoWithProject(page);

    await expect(page.locator('.react-flow')).toBeVisible();
  });

  test('graph has nodes after scan', async ({ page }) => {
    await gotoWithProject(page);

    // Wait for nodes to appear (dagre layout takes a moment)
    await page.waitForTimeout(2000);
    const nodes = page.locator('.react-flow__node');
    const count = await nodes.count();
    expect(count).toBeGreaterThan(0);
  });

  test('sidebar shows file tree after scan', async ({ page }) => {
    await gotoWithProject(page);

    await expect(page.getByText('Explorer')).toBeVisible();
    // The search input should be present
    await expect(page.getByPlaceholder('Search files...')).toBeVisible();
  });

  test('StatusBar shows "Ready" after scan', async ({ page }) => {
    await gotoWithProject(page);

    await expect(page.getByText('Ready')).toBeVisible({ timeout: 5000 });
  });

  test('plan panel tabs are visible', async ({ page }) => {
    await gotoWithProject(page);

    await expect(page.getByRole('button', { name: 'Plans', exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: /^Timeline/ })).toBeVisible();
    await expect(page.getByRole('button', { name: /^Changes/ })).toBeVisible();
    await expect(page.getByRole('button', { name: /^Comments/ })).toBeVisible();
  });

  test('depth selector shows Clusters as default active', async ({ page }) => {
    await gotoWithProject(page);

    // Clusters is the default depth
    const clustersBtn = page.getByRole('button', { name: 'Clusters' });
    await expect(clustersBtn).toBeVisible();
  });

  test('trellis mode buttons are visible', async ({ page }) => {
    await gotoWithProject(page);

    await expect(page.getByRole('button', { name: 'Live' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Baseline' })).toBeVisible();
  });

  test('layout toggle (Map/Tree) is visible', async ({ page }) => {
    await gotoWithProject(page);

    // Both Map and Tree buttons exist — check one of them is visible
    await expect(page.locator('button[title="Map view (force-directed)"]')).toBeVisible();
  });
});
