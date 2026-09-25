/**
 * Settings updates — check button, version display.
 *
 * Covers: Check for Updates button, version display, build info API.
 */

import { test, expect } from '@playwright/test';
import { gotoWithProject, API, authHeaders } from '../helpers/setup';

test.describe('Settings updates', () => {
  test('Updates section shows current version', async ({ page }) => {
    await gotoWithProject(page);

    await page.locator('button[title*="Settings"]').click();
    await page.waitForTimeout(500);
    await page.getByRole('button', { name: 'Updates' }).click();
    await page.waitForTimeout(300);

    // Should show "CodeTrellis v..." text
    await expect(page.getByText('CodeTrellis v').first()).toBeVisible({ timeout: 3000 });
  });

  test('Check for Updates button is visible', async ({ page }) => {
    await gotoWithProject(page);

    await page.locator('button[title*="Settings"]').click();
    await page.waitForTimeout(500);
    await page.getByRole('button', { name: 'Updates' }).click();
    await page.waitForTimeout(300);

    await expect(page.locator('button:has-text("Check for Updates")')).toBeVisible({
      timeout: 3000,
    });
  });

  test('automatic checks can be turned off, and the choice is saved', async ({ page, request }) => {
    await gotoWithProject(page);
    await page.locator('button[title*="Settings"]').click();
    await page.getByRole('button', { name: 'Updates' }).click();

    const toggle = page.getByTestId('updates-auto-check').getByRole('checkbox');
    await expect(toggle).toBeChecked();
    try {
      // Controlled: it turns off when the save comes back, not on the click.
      await toggle.click();
      await expect(toggle).not.toBeChecked();
      await expect.poll(async () => (await (await request.get(`${API}/settings`, { headers: authHeaders() })).json()).updates.autoCheck)
        .toBe(false);
    } finally {
      await request.put(`${API}/settings`, { headers: authHeaders(), data: { updates: { autoCheck: true } } });
    }
  });

  test('Telemetry says what leaves the machine, and when', async ({ page }) => {
    await gotoWithProject(page);
    await page.locator('button[title*="Settings"]').click();
    await page.getByRole('button', { name: 'Telemetry' }).click();
    const outbound = page.getByTestId('telemetry-outbound');
    await expect(outbound).toContainText('Update checks');
    await expect(outbound).toContainText('Spell-check dictionaries ship with the app');
  });

  test('build info API returns version data', async ({ request }) => {
    const res = await request.get(`${API}/build-info`);
    expect(res.ok()).toBeTruthy();
    const info = await res.json();
    expect(info.version).toBeTruthy();
  });

  test('updates status API returns data', async ({ request }) => {
    const res = await request.get(`${API}/updates/status`);
    expect(res.ok()).toBeTruthy();
    const status = await res.json();
    expect(status.currentVersion).toBeTruthy();
  });
});
