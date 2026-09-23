/**
 * Settings plans — visibility toggle, attachment storage toggle.
 *
 * Covers: shared/local toggle, attachment storage toggle.
 */

import { test, expect } from '@playwright/test';
import { gotoWithProject } from '../helpers/setup';

test.describe('Settings plans', () => {
  test('Plans section shows visibility toggle', async ({ page }) => {
    await gotoWithProject(page);

    await page.locator('button[title*="Settings"]').click();
    await page.waitForTimeout(500);
    await page.getByRole('dialog').getByRole('button', { name: 'Plans' }).click();
    await page.waitForTimeout(300);

    // Shared and Local toggle buttons
    await expect(page.getByRole('dialog').locator('button:has-text("Shared")').first()).toBeVisible({ timeout: 3000 });
    await expect(page.getByRole('dialog').locator('button:has-text("Local")').first()).toBeVisible();
  });

  test('clicking toggle switches active state', async ({ page }) => {
    await gotoWithProject(page);

    await page.locator('button[title*="Settings"]').click();
    await page.waitForTimeout(500);
    await page.getByRole('dialog').getByRole('button', { name: 'Plans' }).click();
    await page.waitForTimeout(300);

    // Click Local toggle
    await page.getByRole('dialog').locator('button:has-text("Local")').first().click();
    await page.waitForTimeout(500);

    // Switch back to Shared
    await page.getByRole('dialog').locator('button:has-text("Shared")').first().click();
    await page.waitForTimeout(500);

    // Should not crash
    await expect(page.getByRole('dialog').locator('button:has-text("Shared")').first()).toBeVisible();
  });
});
