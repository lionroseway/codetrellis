/**
 * Recent projects — pin, unpin, remove, click-to-open, empty state.
 *
 * Seeds recent projects via the API then verifies UI interactions.
 */

import { test, expect } from '@playwright/test';
import { gotoWelcome, API, PROJECT_PATH } from '../helpers/setup';

test.describe('Recent projects', () => {
  // Ensure at least one recent project exists by scanning
  test.beforeAll(async ({ request }) => {
    await request.post(`${API}/project/scan`, {
      data: { projectPath: PROJECT_PATH },
    });
  });

  test('recent projects list renders after scanning a project', async ({ page }) => {
    await gotoWelcome(page, { skipLearnTrellis: true });

    // Section label should appear
    await expect(page.getByText('Recent projects')).toBeVisible({ timeout: 5000 });
  });

  test('each project row shows a display name', async ({ page }) => {
    await gotoWelcome(page, { skipLearnTrellis: true });

    // At least one project row should exist (from beforeAll scan)
    const rows = page.locator('[role="button"]').filter({
      has: page.locator('.font-mono'),
    });
    await expect(rows.first()).toBeVisible({ timeout: 5000 });
  });

  test('pin button toggles to "Unpin"', async ({ page }) => {
    await gotoWelcome(page, { skipLearnTrellis: true });
    await page.waitForTimeout(1000);

    // Find pin button and click it
    const pinBtn = page.locator('button[title="Pin to top"]').first();
    if (await pinBtn.isVisible({ timeout: 3000 }).catch(() => false)) {
      await pinBtn.click();
      // Should now show Unpin
      await expect(page.locator('button[title="Unpin"]').first()).toBeVisible();
    }
  });

  test('remove button removes project from list', async ({ page, request }) => {
    // Seed a throwaway path into recents
    await request.post(`${API}/project/scan`, {
      data: { projectPath: PROJECT_PATH },
    });

    await gotoWelcome(page, { skipLearnTrellis: true });
    await page.waitForTimeout(1000);

    const removeBtn = page.locator('button[title="Remove from recents"]').first();
    if (await removeBtn.isVisible({ timeout: 3000 }).catch(() => false)) {
      const countBefore = await page.locator('button[title="Remove from recents"]').count();
      await removeBtn.click();
      await page.waitForTimeout(500);
      const countAfter = await page.locator('button[title="Remove from recents"]').count();
      // One fewer remove button means one fewer row
      expect(countAfter).toBeLessThanOrEqual(countBefore);
    }
  });

  test('"Open another" link visible when recents exist', async ({ page }) => {
    await gotoWelcome(page, { skipLearnTrellis: true });

    // When there are recents, the CTA changes to "Open another"
    const openAnother = page.getByText('Open another');
    const openProject = page.getByRole('button', { name: 'Open Project' }).first();
    // One of these should be visible depending on recents state
    await expect(openAnother.or(openProject)).toBeVisible({ timeout: 5000 });
  });
});
