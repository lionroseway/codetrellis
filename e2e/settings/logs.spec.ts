/**
 * Settings logs — log viewer, reveal button, refresh button.
 *
 * Covers: log output area, Reveal button, Refresh button, logs API.
 */

import { test, expect } from '@playwright/test';
import { gotoWithProject, API } from '../helpers/setup';

test.describe('Settings logs', () => {
  test('Logs section shows log output area', async ({ page }) => {
    await gotoWithProject(page);

    await page.locator('button[title*="Settings"]').click();
    await page.waitForTimeout(500);
    await page.getByRole('button', { name: 'Logs' }).click();
    await page.waitForTimeout(500);

    // Log output in a pre block
    const preBlock = page.locator('pre');
    await expect(preBlock.first()).toBeVisible({ timeout: 5000 });
  });

  test('Reveal button is visible', async ({ page }) => {
    await gotoWithProject(page);

    await page.locator('button[title*="Settings"]').click();
    await page.waitForTimeout(500);
    await page.getByRole('button', { name: 'Logs' }).click();
    await page.waitForTimeout(300);

    await expect(page.locator('button:has-text("Reveal")')).toBeVisible({ timeout: 3000 });
  });

  test('Refresh button is visible', async ({ page }) => {
    await gotoWithProject(page);

    await page.locator('button[title*="Settings"]').click();
    await page.waitForTimeout(500);
    await page.getByRole('button', { name: 'Logs' }).click();
    await page.waitForTimeout(300);

    await expect(page.locator('button:has-text("Refresh")')).toBeVisible({ timeout: 3000 });
  });

  test('logs tail API returns content', async ({ request }) => {
    const res = await request.get(`${API}/logs/tail?maxBytes=65536`);
    expect(res.ok()).toBeTruthy();
    const data = await res.json();
    expect(data.path).toBeTruthy();
    expect(typeof data.content).toBe('string');
  });
});
