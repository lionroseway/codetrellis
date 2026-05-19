/**
 * Inspector panel chrome — expand/collapse, empty state, heading.
 *
 * Covers: Inspector heading visible, empty state when no selection,
 * expand/collapse button, panel renders after project scan.
 */

import { test, expect } from '@playwright/test';
import { gotoWithProject } from '../helpers/setup';

test.describe('Inspector panel chrome', () => {
  /** Scope selectors to the right-side inspector panel (border-l) */
  const inspectorPanel = (page: import('@playwright/test').Page) =>
    page.locator('.glass-panel.border-l');

  test('Inspector panel renders after scan', async ({ page }) => {
    await gotoWithProject(page);

    await expect(inspectorPanel(page)).toBeVisible();
  });

  test('empty state shown when no node is selected', async ({ page }) => {
    await gotoWithProject(page);

    await expect(
      inspectorPanel(page).getByText('Click a cluster, file, or symbol to inspect'),
    ).toBeVisible();
  });

  test('Inspector heading text is visible', async ({ page }) => {
    await gotoWithProject(page);

    // Scope to the inspector panel to avoid matching sidebar tree entries
    await expect(
      inspectorPanel(page).locator('span').filter({ hasText: 'Inspector' }),
    ).toBeVisible();
  });

  test('expand button is visible', async ({ page }) => {
    await gotoWithProject(page);

    await expect(
      inspectorPanel(page).locator('button[title="Expand panel"]'),
    ).toBeVisible();
  });

  test('clicking expand toggles to collapse', async ({ page }) => {
    await gotoWithProject(page);

    await inspectorPanel(page).locator('button[title="Expand panel"]').click();
    await page.waitForTimeout(300);

    await expect(
      inspectorPanel(page).locator('button[title="Collapse panel"]'),
    ).toBeVisible();
  });

  test('clicking collapse toggles back to expand', async ({ page }) => {
    await gotoWithProject(page);

    const panel = inspectorPanel(page);
    // Expand first
    await panel.locator('button[title="Expand panel"]').click();
    await page.waitForTimeout(300);

    // Then collapse
    await panel.locator('button[title="Collapse panel"]').click();
    await page.waitForTimeout(300);

    await expect(panel.locator('button[title="Expand panel"]')).toBeVisible();
  });
});
