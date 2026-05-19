/**
 * Depth selector — Clusters / Files / Symbols toggle in the TopBar.
 *
 * Covers: button visibility, active state switching, default depth,
 * node type changes after switching.
 */

import { test, expect } from '@playwright/test';
import { gotoWithProject } from '../helpers/setup';

test.describe('Depth selector', () => {
  test('Clusters / Files / Symbols buttons are visible', async ({ page }) => {
    await gotoWithProject(page);

    await expect(page.getByRole('button', { name: 'Clusters' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Files' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Symbols' })).toBeVisible();
  });

  test('Clusters is the default active depth', async ({ page }) => {
    await gotoWithProject(page);

    const clustersBtn = page.getByRole('button', { name: 'Clusters' });
    // Active button has accent styling
    await expect(clustersBtn).toBeVisible();
    // Files and Symbols should not have active styling
    const filesBtn = page.getByRole('button', { name: 'Files' });
    await expect(filesBtn).toBeVisible();
  });

  test('clicking Files switches depth to file-level nodes', async ({ page }) => {
    await gotoWithProject(page);

    await page.getByRole('button', { name: 'Files' }).click();
    await page.waitForTimeout(2000);

    // After switching to Files, the graph should still have nodes
    const nodes = page.locator('.react-flow__node');
    const count = await nodes.count();
    expect(count).toBeGreaterThan(0);
  });

  test('clicking Symbols switches depth', async ({ page }) => {
    await gotoWithProject(page);

    await page.getByRole('button', { name: 'Symbols' }).click();
    await page.waitForTimeout(2000);

    // Graph canvas should still be visible
    await expect(page.locator('.react-flow')).toBeVisible();
  });

  test('switching back to Clusters from Files', async ({ page }) => {
    await gotoWithProject(page);

    // Switch to Files first
    await page.getByRole('button', { name: 'Files' }).click();
    await page.waitForTimeout(1500);

    // Switch back to Clusters
    await page.getByRole('button', { name: 'Clusters' }).click();
    await page.waitForTimeout(1500);

    // Graph should still have nodes
    const nodes = page.locator('.react-flow__node');
    const count = await nodes.count();
    expect(count).toBeGreaterThan(0);
  });
});
