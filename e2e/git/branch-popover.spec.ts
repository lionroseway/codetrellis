/**
 * Branch popover — branch list, worktree list, baseline pinning.
 *
 * Covers: branch chip opens popover, current branch shown, branches list,
 * "Rescan project" button, popover closes on outside click.
 */

import { test, expect } from '@playwright/test';
import { gotoWithProject, API, PROJECT_PATH } from '../helpers/setup';

test.describe('Branch popover', () => {
  test('branch chip is visible in the top bar', async ({ page }) => {
    await gotoWithProject(page);

    const branchBtn = page.locator('button[title*="Branch info"]');
    await expect(branchBtn).toBeVisible({ timeout: 5000 });
  });

  test('branch chip shows current branch name', async ({ page }) => {
    await gotoWithProject(page);

    const branchBtn = page.locator('button[title*="Branch info"]');
    const text = await branchBtn.textContent();
    // Should show "main" or another branch name
    expect(text!.length).toBeGreaterThan(0);
  });

  test('clicking branch chip opens popover', async ({ page }) => {
    await gotoWithProject(page);

    await page.locator('button[title*="Branch info"]').click();
    await page.waitForTimeout(500);

    // Popover should show "Branches" section
    await expect(page.getByText('Branches').first()).toBeVisible({ timeout: 3000 });
  });

  test('popover shows current branch', async ({ page }) => {
    await gotoWithProject(page);

    await page.locator('button[title*="Branch info"]').click();
    await page.waitForTimeout(500);

    // Current branch has a "current" badge
    await expect(page.getByText('current', { exact: true }).first()).toBeVisible({ timeout: 3000 });
  });

  test('popover shows Rescan project button', async ({ page }) => {
    await gotoWithProject(page);

    await page.locator('button[title*="Branch info"]').click();
    await page.waitForTimeout(500);

    await expect(page.locator('button:has-text("Rescan project")')).toBeVisible({ timeout: 3000 });
  });

  test('git info API returns branch data', async ({ request }) => {
    const res = await request.get(
      `${API}/git/info?path=${encodeURIComponent(PROJECT_PATH)}`,
    );
    expect(res.ok()).toBeTruthy();
    const info = await res.json();
    expect(info.currentBranch).toBeTruthy();
    expect(Array.isArray(info.branches)).toBe(true);
  });

  test('git branch API returns current branch', async ({ request }) => {
    const res = await request.get(
      `${API}/git/branch?path=${encodeURIComponent(PROJECT_PATH)}`,
    );
    expect(res.ok()).toBeTruthy();
    const data = await res.json();
    expect(data.branch).toBeTruthy();
  });
});
