/**
 * Cluster view — inspector content when a cluster/package node is selected.
 *
 * Covers: cluster name, description, file list, file count,
 * clicking a file navigates to file view.
 */

import { test, expect } from '@playwright/test';
import { gotoWithProject } from '../helpers/setup';

test.describe('Inspector cluster view', () => {
  /** Scope selectors to the right-side inspector panel (border-l) */
  const inspectorPanel = (page: import('@playwright/test').Page) =>
    page.locator('.glass-panel.border-l');

  test('selecting a cluster node shows cluster details', async ({ page }) => {
    await gotoWithProject(page);

    // Default depth is Clusters — click the first node
    await page.waitForTimeout(2000);
    const firstNode = page.locator('.react-flow__node').first();
    await firstNode.click();
    await page.waitForTimeout(500);

    // Inspector should show cluster content — "Files" section header
    const inspector = inspectorPanel(page);
    await expect(inspector.getByText('Files').first()).toBeVisible({ timeout: 3000 });
  });

  test('cluster view shows file count', async ({ page }) => {
    await gotoWithProject(page);

    await page.waitForTimeout(2000);
    const firstNode = page.locator('.react-flow__node').first();
    await firstNode.click();
    await page.waitForTimeout(500);

    // File count is shown as "N files" or "N file"
    const inspector = inspectorPanel(page);
    const fileCount = inspector.getByText(/\d+\s*files?/);
    await expect(fileCount.first()).toBeVisible({ timeout: 3000 });
  });

  test('cluster view lists files as clickable items', async ({ page }) => {
    await gotoWithProject(page);

    await page.waitForTimeout(2000);
    const firstNode = page.locator('.react-flow__node').first();
    await firstNode.click();
    await page.waitForTimeout(1000);

    // File list entries are buttons with font-mono text (filenames)
    const inspector = inspectorPanel(page);
    // Look for buttons that have a monospace span (file paths)
    const fileEntries = inspector.locator('button .font-mono');
    const count = await fileEntries.count();
    expect(count).toBeGreaterThan(0);
  });

  test('clicking a file in cluster view switches to file view', async ({ page }) => {
    await gotoWithProject(page);

    await page.waitForTimeout(2000);
    const firstNode = page.locator('.react-flow__node').first();
    await firstNode.click();
    await page.waitForTimeout(1000);

    // Click the first file entry in the file list
    const inspector = inspectorPanel(page);
    const fileEntry = inspector.locator('button').filter({ has: page.locator('.font-mono') }).first();

    if (await fileEntry.isVisible()) {
      await fileEntry.click();
      await page.waitForTimeout(500);

      // Inspector should now show file view — look for "View source" button
      await expect(inspector.getByText('View source')).toBeVisible({ timeout: 3000 });
    }
  });
});
