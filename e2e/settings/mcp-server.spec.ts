/**
 * Settings MCP server — port input, autodetect toggle, config snippet.
 *
 * Covers: port input, autodetect checkbox, config snippet with Copy button.
 */

import { test, expect } from '@playwright/test';
import { gotoWithProject, API } from '../helpers/setup';

test.describe('Settings MCP server', () => {
  test('MCP Server section shows port input', async ({ page }) => {
    await gotoWithProject(page);

    await page.locator('button[title*="Settings"]').click();
    await page.waitForTimeout(500);
    await page.getByRole('button', { name: 'MCP Server' }).click();
    await page.waitForTimeout(300);

    // Port input should show 19432 or similar
    const portInput = page.locator('input[type="number"]');
    await expect(portInput).toBeVisible({ timeout: 3000 });
  });

  test('autodetect checkbox is visible', async ({ page }) => {
    await gotoWithProject(page);

    await page.locator('button[title*="Settings"]').click();
    await page.waitForTimeout(500);
    await page.getByRole('button', { name: 'MCP Server' }).click();
    await page.waitForTimeout(300);

    await expect(page.getByText('Autodetect on collision').first()).toBeVisible({ timeout: 3000 });
  });

  test('config snippet shows JSON with Copy button', async ({ page }) => {
    await gotoWithProject(page);

    await page.locator('button[title*="Settings"]').click();
    await page.waitForTimeout(500);
    await page.getByRole('button', { name: 'MCP Server' }).click();
    await page.waitForTimeout(300);

    // Config snippet in a pre block
    const preBlock = page.locator('pre');
    await expect(preBlock.first()).toBeVisible({ timeout: 3000 });

    // Copy button nearby
    await expect(page.locator('button:has-text("Copy")').first()).toBeVisible();
  });

  test('MCP status API returns port info', async ({ request }) => {
    const res = await request.get(`${API}/mcp/status`);
    expect(res.ok()).toBeTruthy();
    const status = await res.json();
    expect(status.port).toBeTruthy();
  });

  test('default port is 19432', async ({ page }) => {
    await gotoWithProject(page);

    await page.locator('button[title*="Settings"]').click();
    await page.waitForTimeout(500);
    await page.getByRole('button', { name: 'MCP Server' }).click();
    await page.waitForTimeout(300);

    await expect(page.getByText('19432').first()).toBeVisible({ timeout: 3000 });
  });
});
