/**
 * Settings modal chrome — open, sidebar nav, close with Escape.
 *
 * Covers: settings button opens modal, sidebar shows all sections,
 * clicking sections changes content, Escape closes.
 */

import { test, expect } from '@playwright/test';
import { gotoWithProject } from '../helpers/setup';

test.describe('Settings modal chrome', () => {
  test('Settings button opens the modal', async ({ page }) => {
    await gotoWithProject(page);

    await page.locator('button[title*="Settings"]').click();
    await page.waitForTimeout(500);

    await expect(page.getByRole('button', { name: 'Identity' })).toBeVisible({ timeout: 3000 });
  });

  test('sidebar shows all 8 section buttons', async ({ page }) => {
    await gotoWithProject(page);

    await page.locator('button[title*="Settings"]').click();
    await page.waitForTimeout(500);

    // Scope to the settings dialog to avoid "Plans" matching the PlanPanel tab
    const dialog = page.getByRole('dialog');
    await expect(dialog.getByRole('button', { name: 'Identity' })).toBeVisible({ timeout: 3000 });
    await expect(dialog.getByRole('button', { name: 'MCP Server' })).toBeVisible();
    await expect(dialog.getByRole('button', { name: 'Plans' })).toBeVisible();
    await expect(dialog.getByRole('button', { name: 'Data', exact: true })).toBeVisible();
    await expect(dialog.getByRole('button', { name: 'Logs' })).toBeVisible();
    await expect(dialog.getByRole('button', { name: 'Telemetry' })).toBeVisible();
    await expect(dialog.getByRole('button', { name: 'Updates' })).toBeVisible();
    await expect(dialog.getByRole('button', { name: 'About' })).toBeVisible();
  });

  test('clicking a section changes the content area', async ({ page }) => {
    await gotoWithProject(page);

    await page.locator('button[title*="Settings"]').click();
    await page.waitForTimeout(500);

    // Click MCP Server
    await page.getByRole('button', { name: 'MCP Server' }).click();
    await page.waitForTimeout(300);

    // Should show port-related content
    await expect(page.getByText('19432').first()).toBeVisible({ timeout: 3000 });
  });

  test('Escape closes the settings modal', async ({ page }) => {
    await gotoWithProject(page);

    await page.locator('button[title*="Settings"]').click();
    await page.waitForTimeout(500);
    await expect(page.getByRole('button', { name: 'Identity' })).toBeVisible({ timeout: 3000 });

    await page.keyboard.press('Escape');
    await page.waitForTimeout(500);

    await expect(page.getByRole('button', { name: 'Identity' })).not.toBeVisible();
  });

  test('clicking through all sections does not crash', async ({ page }) => {
    await gotoWithProject(page);

    await page.locator('button[title*="Settings"]').click();
    await page.waitForTimeout(500);

    // Scope to dialog to avoid "Plans" matching PlanPanel tab
    const dialog = page.getByRole('dialog');
    const sections = ['Identity', 'MCP Server', 'Plans', 'Data', 'Logs', 'Telemetry', 'Updates', 'About'];
    for (const section of sections) {
      await dialog.getByRole('button', { name: section, exact: true }).click();
      await page.waitForTimeout(200);
    }

    // Should still be on About section, modal still open
    await expect(dialog.getByRole('button', { name: 'About' })).toBeVisible();
  });
});
