/**
 * Node click — single-click select, inspector opens, graph expand.
 *
 * Covers: clicking a graph node selects it, inspector panel shows
 * relevant content, clicking Escape deselects.
 */

import { test, expect } from '@playwright/test';
import { gotoWithProject } from '../helpers/setup';

test.describe('Node click', () => {
  /** Scope selectors to the right-side inspector panel */
  const inspectorPanel = (page: import('@playwright/test').Page) =>
    page.locator('.glass-panel.border-l');

  test('clicking a node shows Inspector panel content', async ({ page }) => {
    await gotoWithProject(page);

    await page.waitForTimeout(2000);
    const firstNode = page.locator('.react-flow__node').first();
    await expect(firstNode).toBeVisible();

    await firstNode.click();
    await page.waitForTimeout(500);

    // Inspector should now show content (not the empty state)
    const inspector = inspectorPanel(page);
    await expect(
      inspector.getByText('Click a cluster, file, or symbol to inspect'),
    ).not.toBeVisible({ timeout: 3000 });
  });

  test('Inspector empty state shown when no node is selected', async ({ page }) => {
    await gotoWithProject(page);

    // By default, no node is selected — Inspector shows empty state
    const inspector = inspectorPanel(page);
    await expect(
      inspector.getByText('Click a cluster, file, or symbol to inspect'),
    ).toBeVisible();
  });

  test('clicking another node switches Inspector content', async ({ page }) => {
    await gotoWithProject(page);

    await page.waitForTimeout(2000);
    const nodes = page.locator('.react-flow__node');
    const count = await nodes.count();

    if (count < 2) {
      test.skip();
      return;
    }

    // Click first node
    await nodes.nth(0).click();
    await page.waitForTimeout(500);

    // Click second node
    await nodes.nth(1).click();
    await page.waitForTimeout(500);

    // Inspector should still be showing content
    const inspector = inspectorPanel(page);
    await expect(
      inspector.getByText('Click a cluster, file, or symbol to inspect'),
    ).not.toBeVisible();
  });

  test('Escape key deselects node', async ({ page }) => {
    await gotoWithProject(page);

    await page.waitForTimeout(2000);
    const firstNode = page.locator('.react-flow__node').first();
    await firstNode.click();
    await page.waitForTimeout(500);

    const inspector = inspectorPanel(page);
    // Verify node was selected
    await expect(
      inspector.getByText('Click a cluster, file, or symbol to inspect'),
    ).not.toBeVisible();

    // Press Escape to deselect
    await page.keyboard.press('Escape');
    await page.waitForTimeout(500);

    // Inspector should revert to empty state
    await expect(
      inspector.getByText('Click a cluster, file, or symbol to inspect'),
    ).toBeVisible();
  });
});
