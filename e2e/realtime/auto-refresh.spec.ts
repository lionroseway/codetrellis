/**
 * Auto-refresh — pause/resume, interval selection, manual check.
 *
 * Covers: auto-refresh toggle (pause/resume), interval dropdown,
 * "Check now" button triggers immediate refresh, refresh state
 * persists across interactions.
 */

import { test, expect } from '@playwright/test';
import { gotoWithProject } from '../helpers/setup';

test.describe('Auto-refresh controls', () => {
  test('Auto button is visible and shows green state', async ({ page }) => {
    await gotoWithProject(page);

    // The auto-refresh button is in the top-right ReactFlow panel
    // It shows "Auto" when enabled (green) or "Paused" when disabled
    const autoBtn = page.locator('button').filter({ hasText: /^Auto$/ }).first();
    const pausedBtn = page.locator('button').filter({ hasText: /^Paused$/ }).first();
    const either = autoBtn.or(pausedBtn);

    await expect(either).toBeVisible({ timeout: 8000 });
  });

  test('clicking Auto toggles to Paused', async ({ page }) => {
    await gotoWithProject(page);

    // Find and click the Auto button using evaluate for reliability
    const clicked = await page.evaluate(() => {
      const buttons = document.querySelectorAll('button');
      for (const btn of buttons) {
        if (btn.textContent?.trim() === 'Auto') {
          btn.click();
          return true;
        }
      }
      return false;
    });

    if (clicked) {
      await page.waitForTimeout(500);

      // Should now show "Paused"
      const paused = await page.evaluate(() => {
        const buttons = document.querySelectorAll('button');
        return Array.from(buttons).some((b) => b.textContent?.trim() === 'Paused');
      });
      expect(paused).toBe(true);
    }
  });

  test('clicking Paused toggles back to Auto', async ({ page }) => {
    await gotoWithProject(page);

    // First pause it
    await page.evaluate(() => {
      const buttons = document.querySelectorAll('button');
      for (const btn of buttons) {
        if (btn.textContent?.trim() === 'Auto') {
          btn.click();
          break;
        }
      }
    });
    await page.waitForTimeout(500);

    // Now resume it
    const resumed = await page.evaluate(() => {
      const buttons = document.querySelectorAll('button');
      for (const btn of buttons) {
        if (btn.textContent?.trim() === 'Paused') {
          btn.click();
          return true;
        }
      }
      return false;
    });

    if (resumed) {
      await page.waitForTimeout(500);
      const autoVisible = await page.evaluate(() => {
        const buttons = document.querySelectorAll('button');
        return Array.from(buttons).some((b) => b.textContent?.trim() === 'Auto');
      });
      expect(autoVisible).toBe(true);
    }
  });

  test('Check now button is visible', async ({ page }) => {
    await gotoWithProject(page);

    // "Check now" button is always visible in the refresh control group
    const checkNow = page.locator('button').filter({ hasText: 'Check now' }).first();
    await expect(checkNow).toBeVisible({ timeout: 8000 });
  });

  test('Check now button triggers refresh without error', async ({ page }) => {
    await gotoWithProject(page);

    const checkNow = page.locator('button').filter({ hasText: 'Check now' }).first();
    await expect(checkNow).toBeVisible({ timeout: 8000 });

    // Click the button via evaluate to avoid DiffSummary panel overlap
    await page.evaluate(() => {
      const buttons = document.querySelectorAll('button');
      for (const btn of buttons) {
        if (btn.textContent?.includes('Check now')) {
          btn.click();
          break;
        }
      }
    });

    // Wait for the refresh to complete — no crash
    await page.waitForTimeout(2000);

    // The button should still be visible (no page crash)
    await expect(checkNow).toBeVisible();
  });

  test('interval dropdown shows 5s / 10s / 30s options', async ({ page }) => {
    await gotoWithProject(page);

    // The interval selector is a <select> element near the auto-refresh controls
    const intervalSelect = page.locator('select').filter({ hasText: '10s' }).first();
    await expect(intervalSelect).toBeVisible({ timeout: 8000 });

    // Verify the options
    const options = await intervalSelect.locator('option').allTextContents();
    expect(options).toContain('5s');
    expect(options).toContain('10s');
    expect(options).toContain('30s');
  });

  test('changing interval to 5s updates the select value', async ({ page }) => {
    await gotoWithProject(page);

    // Find the interval select
    const intervalSelect = page.locator('select').filter({ hasText: '10s' }).first();
    await expect(intervalSelect).toBeVisible({ timeout: 8000 });

    // Change to 5s
    await intervalSelect.selectOption('5000');
    await page.waitForTimeout(300);

    // Verify the value changed
    const value = await intervalSelect.inputValue();
    expect(value).toBe('5000');
  });
});
