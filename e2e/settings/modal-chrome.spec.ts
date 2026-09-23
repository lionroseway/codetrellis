/**
 * Settings modal chrome — open, sidebar nav, close with Escape.
 *
 * Covers: settings button opens modal, sidebar shows all sections,
 * clicking sections changes content, Escape closes.
 */

import { test, expect } from '@playwright/test';
import { gotoWithProject } from '../helpers/setup';

/** The sidebar, in order. Twelve since Appearance, Devices, Power and Sync joined. */
const SECTIONS = [
  'Identity', 'Appearance', 'MCP Server', 'Plans', 'Data', 'Devices',
  'Power', 'Sync', 'Logs', 'Telemetry', 'Updates', 'About',
];

test.describe('Settings modal chrome', () => {
  test('Settings button opens the modal', async ({ page }) => {
    await gotoWithProject(page);

    await page.locator('button[title*="Settings"]').click();
    await page.waitForTimeout(500);

    await expect(page.getByRole('button', { name: 'Identity' })).toBeVisible({ timeout: 3000 });
  });

  test('sidebar shows every section', async ({ page }) => {
    await gotoWithProject(page);

    await page.locator('button[title*="Settings"]').click();

    // Scoped to the Settings dialog: "Plans", "Data" and "Live" also name
    // buttons (and folders in the file tree) outside it.
    const dialog = page.getByRole('dialog', { name: 'Settings' });
    for (const section of SECTIONS) {
      await expect(dialog.getByRole('button', { name: section, exact: true })).toBeVisible({ timeout: 3000 });
    }
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
    const dialog = page.getByRole('dialog', { name: 'Settings' });
    await expect(dialog).toBeVisible({ timeout: 3000 });

    await page.keyboard.press('Escape');
    await expect(dialog).toHaveCount(0);
  });

  test('clicking through all sections does not crash', async ({ page }) => {
    await gotoWithProject(page);

    await page.locator('button[title*="Settings"]').click();
    const dialog = page.getByRole('dialog', { name: 'Settings' });
    for (const section of SECTIONS) {
      await dialog.getByRole('button', { name: section, exact: true }).click();
    }

    // Still open, on the last section.
    await expect(dialog.getByRole('button', { name: 'About', exact: true })).toBeVisible();
  });
});
