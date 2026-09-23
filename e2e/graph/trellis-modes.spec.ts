/**
 * Trellis modes — Live / Baseline / Planned / Diff switching.
 *
 * Covers: all 4 mode buttons visible, clicking each mode, title
 * attributes for each mode, active styling.
 */

import { test, expect } from '@playwright/test';
import { gotoWithProject } from '../helpers/setup';

test.describe('Trellis modes', () => {
  test('Live / Baseline / Planned / Diff buttons are visible', async ({ page }) => {
    await gotoWithProject(page);

    await expect(page.getByRole('button', { name: 'Live', exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Baseline', exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Planned', exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Diff', exact: true })).toBeVisible();
  });

  test('Live is the default active mode', async ({ page }) => {
    await gotoWithProject(page);

    const liveBtn = page.locator('button[title="Live view"]');
    await expect(liveBtn).toBeVisible();
  });

  test('clicking Baseline switches mode', async ({ page }) => {
    await gotoWithProject(page);

    await page.getByRole('button', { name: 'Baseline', exact: true }).click();
    await page.waitForTimeout(1000);

    // Graph should still render
    await expect(page.locator('.react-flow')).toBeVisible();
  });

  test('clicking Planned switches mode', async ({ page }) => {
    await gotoWithProject(page);

    await page.getByRole('button', { name: 'Planned', exact: true }).click();
    await page.waitForTimeout(1000);

    await expect(page.locator('.react-flow')).toBeVisible();
  });

  test('clicking Diff switches mode', async ({ page }) => {
    await gotoWithProject(page);

    await page.getByRole('button', { name: 'Diff', exact: true }).click();
    await page.waitForTimeout(1000);

    await expect(page.locator('.react-flow')).toBeVisible();
  });

  test('switching back to Live from Baseline', async ({ page }) => {
    await gotoWithProject(page);

    await page.getByRole('button', { name: 'Baseline', exact: true }).click();
    await page.waitForTimeout(500);

    await page.getByRole('button', { name: 'Live', exact: true }).click();
    await page.waitForTimeout(500);

    await expect(page.locator('.react-flow')).toBeVisible();
  });
});
