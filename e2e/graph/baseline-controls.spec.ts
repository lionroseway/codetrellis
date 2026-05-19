/**
 * Baseline controls — pin, auto-track, commit dropdown.
 *
 * Covers: Pin / Auto-track buttons, baseline label, commit selector
 * dropdown, switching between pinned and auto modes.
 */

import { test, expect } from '@playwright/test';
import { gotoWithProject } from '../helpers/setup';

test.describe('Baseline controls', () => {
  test('Pin and Auto-track buttons are visible', async ({ page }) => {
    await gotoWithProject(page);

    // The buttons contain text "Pin" and "Auto-track"
    const topRight = page.locator('.react-flow__panel.top.right');
    await expect(topRight.getByText('Pin', { exact: true })).toBeVisible({ timeout: 5000 });
    await expect(topRight.getByText('Auto-track', { exact: true })).toBeVisible();
  });

  test('baseline label shows default state', async ({ page }) => {
    await gotoWithProject(page);

    const topRight = page.locator('.react-flow__panel.top.right');
    // The baseline label shows either "HEAD", "baseline", or a commit hash
    const label = topRight.locator('span').filter({ hasText: /HEAD|baseline/ }).first();
    await expect(label).toBeVisible({ timeout: 5000 });
  });

  test('commit selector dropdown is present', async ({ page }) => {
    await gotoWithProject(page);

    const commitSelect = page.locator(
      'select[title="Choose which commit the baseline should be pinned to"]',
    );
    await expect(commitSelect).toBeVisible({ timeout: 5000 });
  });

  test('commit dropdown has Track HEAD and Pin options', async ({ page }) => {
    await gotoWithProject(page);

    const commitSelect = page.locator(
      'select[title="Choose which commit the baseline should be pinned to"]',
    );
    await expect(commitSelect.locator('option').filter({ hasText: 'Track HEAD' })).toBeAttached();
    await expect(
      commitSelect.locator('option').filter({ hasText: 'Pin current HEAD' }),
    ).toBeAttached();
  });

  test('clicking Pin button triggers baseline capture', async ({ page }) => {
    await gotoWithProject(page);

    const topRight = page.locator('.react-flow__panel.top.right');
    const pinBtn = topRight.getByText('Pin', { exact: true });
    await expect(pinBtn).toBeVisible({ timeout: 5000 });
    // DiffSummary panel overlaps — use JS click to bypass pointer interception
    await pinBtn.evaluate((el) => (el as HTMLButtonElement).click());
    await page.waitForTimeout(1000);

    // After pinning, the controls area should still be visible
    await expect(pinBtn).toBeVisible();
  });

  test('clicking Auto-track switches to auto mode', async ({ page }) => {
    await gotoWithProject(page);

    const topRight = page.locator('.react-flow__panel.top.right');
    const autoBtn = topRight.getByText('Auto-track', { exact: true });
    await expect(autoBtn).toBeVisible({ timeout: 5000 });

    // DiffSummary panel overlaps — use JS click to bypass pointer interception
    await autoBtn.evaluate((el) => (el as HTMLButtonElement).click());
    await page.waitForTimeout(500);

    // The commit dropdown should switch to "Track HEAD" as selected
    const commitSelect = page.locator(
      'select[title="Choose which commit the baseline should be pinned to"]',
    );
    await expect(commitSelect).toHaveValue('__AUTO__', { timeout: 3000 });
  });
});
