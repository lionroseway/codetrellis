/**
 * Settings data — data directory override input.
 *
 * Covers: data dir input field visible, placeholder text.
 */

import { test, expect } from '@playwright/test';
import { gotoWithProject } from '../helpers/setup';

test.describe('Settings data', () => {
  test('Data section shows directory override input', async ({ page }) => {
    await gotoWithProject(page);

    await page.locator('button[title*="Settings"]').click();
    await page.waitForTimeout(500);
    await page.getByRole('button', { name: 'Data', exact: true }).click();
    await page.waitForTimeout(300);

    const input = page.locator('input[placeholder*="/path/to"]');
    await expect(input).toBeVisible({ timeout: 3000 });
  });

  test('Data section mentions restart requirement', async ({ page }) => {
    await gotoWithProject(page);

    await page.locator('button[title*="Settings"]').click();
    await page.waitForTimeout(500);
    await page.getByRole('button', { name: 'Data', exact: true }).click();
    await page.waitForTimeout(300);

    // Should mention restart
    await expect(page.getByText('restart').first()).toBeVisible({ timeout: 3000 });
  });
});
