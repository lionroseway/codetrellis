/**
 * Connected agents widget — agent count badge and popover.
 *
 * Covers: "No agents" default state, popover opens/closes,
 * empty state message, agent status API.
 */

import { test, expect } from '@playwright/test';
import { gotoWithProject, API } from '../helpers/setup';

test.describe('Connected agents widget', () => {
  test('"No agents" text visible by default', async ({ page }) => {
    await gotoWithProject(page);

    await expect(page.getByText('No agents').first()).toBeVisible({ timeout: 5000 });
  });

  test('clicking No agents opens popover', async ({ page }) => {
    await gotoWithProject(page);

    await page.locator('button:has-text("No agents")').click();
    await page.waitForTimeout(500);

    // Popover should show "Connected agents" header
    await expect(page.getByText('Connected agents').first()).toBeVisible({ timeout: 3000 });
  });

  test('popover shows empty state when no agents connected', async ({ page }) => {
    await gotoWithProject(page);

    await page.locator('button:has-text("No agents")').click();
    await page.waitForTimeout(500);

    // Empty state message mentions MCP
    await expect(page.getByText('No agents connected via MCP').first()).toBeVisible({
      timeout: 3000,
    });
  });

  test('clicking outside popover closes it', async ({ page }) => {
    await gotoWithProject(page);

    await page.locator('button:has-text("No agents")').click();
    await page.waitForTimeout(500);
    await expect(page.getByText('Connected agents').first()).toBeVisible({ timeout: 3000 });

    // Click on the sidebar to close
    await page.locator('.glass-panel.border-r').click({ force: true });
    await page.waitForTimeout(500);

    await expect(page.locator('[data-connected-agents-popover]')).not.toBeVisible();
  });

  test('agent status API returns data', async ({ request }) => {
    const res = await request.get(`${API}/agent/status`);
    expect(res.ok()).toBeTruthy();
  });

  test('sessions API returns array', async ({ request }) => {
    const res = await request.get(`${API}/sessions`);
    expect(res.ok()).toBeTruthy();
    const sessions = await res.json();
    expect(Array.isArray(sessions)).toBe(true);
  });
});
