/**
 * Settings about — version, build info, copy button.
 *
 * Covers: version display, build number, Copy button, "Open Updates" link.
 */

import { test, expect } from '@playwright/test';
import { gotoWithProject } from '../helpers/setup';

test.describe('Settings about', () => {
  test('About section shows CodeTrellis name', async ({ page }) => {
    await gotoWithProject(page);

    await page.locator('button[title*="Settings"]').click();
    await page.waitForTimeout(500);
    await page.getByRole('button', { name: 'About' }).click();
    await page.waitForTimeout(300);

    await expect(page.getByText('CodeTrellis').first()).toBeVisible({ timeout: 3000 });
  });

  test('About section shows version number', async ({ page }) => {
    await gotoWithProject(page);

    await page.locator('button[title*="Settings"]').click();
    await page.waitForTimeout(500);
    await page.getByRole('button', { name: 'About' }).click();
    await page.waitForTimeout(300);

    // Version number like "v0.1.4"
    const versionEl = page.locator('span.font-mono').filter({ hasText: /^v\d/ }).first();
    await expect(versionEl).toBeVisible({ timeout: 3000 });
  });

  test('Copy button copies build info', async ({ page }) => {
    await gotoWithProject(page);

    await page.locator('button[title*="Settings"]').click();
    await page.waitForTimeout(500);
    await page.getByRole('button', { name: 'About' }).click();
    await page.waitForTimeout(300);

    const copyBtn = page.locator('button:has-text("Copy")').first();
    await expect(copyBtn).toBeVisible({ timeout: 3000 });

    await copyBtn.click();
    await page.waitForTimeout(500);

    // Button text should change to "Copied"
    await expect(page.locator('button:has-text("Copied")').first()).toBeVisible({ timeout: 3000 });
  });

  test('"Open Updates" button is visible', async ({ page }) => {
    await gotoWithProject(page);

    await page.locator('button[title*="Settings"]').click();
    await page.waitForTimeout(500);
    await page.getByRole('button', { name: 'About' }).click();
    await page.waitForTimeout(300);

    await expect(page.locator('button:has-text("Open Updates")')).toBeVisible({ timeout: 3000 });
  });

  test('"Open Updates" navigates to Updates section', async ({ page }) => {
    await gotoWithProject(page);

    await page.locator('button[title*="Settings"]').click();
    await page.waitForTimeout(500);
    await page.getByRole('button', { name: 'About' }).click();
    await page.waitForTimeout(300);

    await page.locator('button:has-text("Open Updates")').click();
    await page.waitForTimeout(300);

    // Should now be on Updates section
    await expect(page.locator('button:has-text("Check for Updates")')).toBeVisible({
      timeout: 3000,
    });
  });
});
