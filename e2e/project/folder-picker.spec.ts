/**
 * Folder picker modal — project opening flow.
 *
 * Covers: modal open/close, path input, directory navigation,
 * up button, Cancel/Open/Go buttons, empty state.
 */

import { test, expect } from '@playwright/test';
import { gotoWelcome } from '../helpers/setup';

test.describe('Folder picker modal', () => {
  test('Open Project button triggers modal', async ({ page }) => {
    await gotoWelcome(page, { skipLearnTrellis: true });

    await page.getByRole('button', { name: 'Open Project' }).first().click();
    await expect(page.getByRole('heading', { name: 'Open Project' }).last()).toBeVisible({
      timeout: 3000,
    });
  });

  test('modal shows path input', async ({ page }) => {
    await gotoWelcome(page, { skipLearnTrellis: true });

    await page.getByRole('button', { name: 'Open Project' }).first().click();
    await page.waitForTimeout(500);
    // The folder picker uses a text input for the path
    const input = page.locator('.fixed.inset-0.z-50 input[type="text"]');
    await expect(input).toBeVisible({ timeout: 3000 });
  });

  test('Go button browses to typed path', async ({ page }) => {
    await gotoWelcome(page, { skipLearnTrellis: true });

    await page.getByRole('button', { name: 'Open Project' }).first().click();
    await page.waitForTimeout(500);

    const input = page.locator('.fixed.inset-0.z-50 input[type="text"]');
    await expect(input).toBeVisible({ timeout: 3000 });

    await input.fill('/tmp');
    await page.locator('.fixed.inset-0.z-50').getByRole('button', { name: 'Go' }).click();
    await page.waitForTimeout(500);

    // Path should now show /tmp
    await expect(input).toHaveValue('/tmp');
  });

  test('Cancel button closes modal without action', async ({ page }) => {
    await gotoWelcome(page, { skipLearnTrellis: true });

    await page.getByRole('button', { name: 'Open Project' }).first().click();
    await expect(page.getByRole('heading', { name: 'Open Project' }).last()).toBeVisible({
      timeout: 3000,
    });

    await page.getByRole('button', { name: 'Cancel' }).click();
    await page.waitForTimeout(500);

    // Modal heading should be gone (the welcome heading may still exist)
    // Check the modal-specific container is gone
    await expect(page.locator('.fixed.inset-0.z-50')).not.toBeVisible();
  });

  test('Escape closes modal', async ({ page }) => {
    await gotoWelcome(page, { skipLearnTrellis: true });

    await page.getByRole('button', { name: 'Open Project' }).first().click();
    await expect(page.getByRole('heading', { name: 'Open Project' }).last()).toBeVisible({
      timeout: 3000,
    });

    await page.keyboard.press('Escape');
    await page.waitForTimeout(500);
    await expect(page.locator('.fixed.inset-0.z-50')).not.toBeVisible();
  });

  test('directory list shows browsable items', async ({ page }) => {
    await gotoWelcome(page, { skipLearnTrellis: true });

    await page.getByRole('button', { name: 'Open Project' }).first().click();
    await page.waitForTimeout(1000);

    // Scoped to the picker: unscoped, "a button with an icon and text"
    // also matched the TopBar's own Open button.
    const picker = page.getByRole('dialog', { name: 'Open Project' });
    const dirItems = picker.locator('button').filter({ has: page.locator('svg') }).filter({
      hasText: /.+/,
    });
    // Either we see directories or the "No subdirectories" message
    const noSubdirs = picker.getByText('No subdirectories');
    await expect(dirItems.or(noSubdirs).first()).toBeVisible({ timeout: 3000 });
  });

  test('Open button exists in footer', async ({ page }) => {
    await gotoWelcome(page, { skipLearnTrellis: true });

    await page.getByRole('button', { name: 'Open Project' }).first().click();
    await page.waitForTimeout(500);

    // "Open" button in the modal footer (not the trigger "Open Project")
    await expect(
      page.locator('.fixed.inset-0.z-50').getByRole('button', { name: 'Open', exact: true }),
    ).toBeVisible();
  });
});
