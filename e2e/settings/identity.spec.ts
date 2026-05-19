/**
 * Settings identity — name/email inputs, pull from git config.
 *
 * Covers: name input, email input, "Pull from git config" button,
 * settings API endpoints.
 */

import { test, expect } from '@playwright/test';
import { gotoWithProject, API } from '../helpers/setup';

test.describe('Settings identity', () => {
  test('Identity section shows name and email inputs', async ({ page }) => {
    await gotoWithProject(page);

    await page.locator('button[title*="Settings"]').click();
    await page.waitForTimeout(500);
    await page.getByRole('button', { name: 'Identity' }).click();
    await page.waitForTimeout(300);

    await expect(page.locator('input[placeholder="Your name"]')).toBeVisible({ timeout: 3000 });
    await expect(page.locator('input[placeholder="you@example.com"]')).toBeVisible();
  });

  test('"Pull from git config" button is visible', async ({ page }) => {
    await gotoWithProject(page);

    await page.locator('button[title*="Settings"]').click();
    await page.waitForTimeout(500);
    await page.getByRole('button', { name: 'Identity' }).click();
    await page.waitForTimeout(300);

    await expect(page.locator('button:has-text("Pull from git config")')).toBeVisible({
      timeout: 3000,
    });
  });

  test('settings API returns current settings', async ({ request }) => {
    const res = await request.get(`${API}/settings`);
    expect(res.ok()).toBeTruthy();
    const settings = await res.json();
    expect(settings).toBeTruthy();
  });

  test('git defaults endpoint returns name and email', async ({ request }) => {
    const res = await request.get(
      `${API}/identity/git-defaults?project=${encodeURIComponent(process.cwd())}`,
    );
    expect(res.ok()).toBeTruthy();
    const defaults = await res.json();
    // At least one of name or email should be present from git config
    expect(defaults.name !== undefined || defaults.email !== undefined).toBe(true);
  });
});
