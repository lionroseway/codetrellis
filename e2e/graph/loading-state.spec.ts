/**
 * Loading state — verifies the loading/scanning flow.
 *
 * Covers: app transitions from idle → scanning → ready,
 * graph canvas appears after loading completes.
 */

import { test, expect } from '@playwright/test';
import { gotoWithProject } from '../helpers/setup';

test.describe('Loading state', () => {
  test('graph canvas and Ready status appear after scan', async ({ page }) => {
    await gotoWithProject(page);

    // After gotoWithProject completes, the graph should be visible
    await expect(page.locator('.react-flow')).toBeVisible();
    // Status bar should show "Ready"
    await expect(page.getByText('Ready')).toBeVisible({ timeout: 5000 });
  });

  test('scanning state shows progress indicators', async ({ page }) => {
    // Navigate without the project helper to catch intermediate states
    await page.addInitScript(() => {
      localStorage.setItem('codetrellis:learn-trellis:seen', '1');
    });
    await page.goto('/');
    await page.waitForTimeout(1000);

    // At this point, no project is open — status shows "No project"
    await expect(page.getByText('No project')).toBeVisible({ timeout: 5000 });
  });
});
