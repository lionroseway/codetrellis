/**
 * MCP guide modal — 3-step connection wizard.
 *
 * Covers: modal opens, 3 steps visible, Copy Config button,
 * Done button closes, agent paths listed.
 */

import { test, expect } from '@playwright/test';
import { gotoWithProject } from '../helpers/setup';

test.describe('MCP guide modal', () => {
  test('Connect Agent button opens the modal', async ({ page }) => {
    await gotoWithProject(page);

    await page.locator('button:has-text("Connect Agent")').click();
    await page.waitForTimeout(500);

    await expect(page.getByText('Connect an AI Agent')).toBeVisible({ timeout: 3000 });
  });

  test('modal shows 3 steps', async ({ page }) => {
    await gotoWithProject(page);

    await page.locator('button:has-text("Connect Agent")').click();
    await page.waitForTimeout(500);

    await expect(page.getByText('Copy the MCP config')).toBeVisible({ timeout: 3000 });
    await expect(page.getByText('Add to your agent settings')).toBeVisible();
    await expect(page.getByText('Start using')).toBeVisible();
  });

  test('Copy Config button is visible', async ({ page }) => {
    await gotoWithProject(page);

    await page.locator('button:has-text("Connect Agent")').click();
    await page.waitForTimeout(500);

    await expect(page.locator('button:has-text("Copy Config")')).toBeVisible({ timeout: 3000 });
  });

  test('clicking Copy Config changes text to Copied', async ({ page }) => {
    await gotoWithProject(page);

    await page.locator('button:has-text("Connect Agent")').click();
    await page.waitForTimeout(500);

    await page.locator('button:has-text("Copy Config")').click();
    await page.waitForTimeout(500);

    await expect(page.locator('button:has-text("Copied!")')).toBeVisible({ timeout: 3000 });
  });

  test('Done button is visible', async ({ page }) => {
    await gotoWithProject(page);

    await page.locator('button:has-text("Connect Agent")').click();
    await page.waitForTimeout(500);

    await expect(page.locator('button:has-text("Done")')).toBeVisible({ timeout: 3000 });
  });

  test('Done button closes the modal', async ({ page }) => {
    await gotoWithProject(page);

    await page.locator('button:has-text("Connect Agent")').click();
    await page.waitForTimeout(500);
    await expect(page.getByText('Connect an AI Agent')).toBeVisible({ timeout: 3000 });

    await page.locator('button:has-text("Done")').click();
    await page.waitForTimeout(500);

    await expect(page.getByText('Connect an AI Agent')).not.toBeVisible();
  });

  test('modal shows agent path references', async ({ page }) => {
    await gotoWithProject(page);

    await page.locator('button:has-text("Connect Agent")').click();
    await page.waitForTimeout(500);

    // Step 2 should mention agent types
    await expect(page.getByText('Claude Code').first()).toBeVisible({ timeout: 3000 });
  });

  test('modal shows MCP config snippet in pre block', async ({ page }) => {
    await gotoWithProject(page);

    await page.locator('button:has-text("Connect Agent")').click();
    await page.waitForTimeout(500);

    // Config snippet should be in a pre element
    const preBlock = page.locator('pre').first();
    await expect(preBlock).toBeVisible({ timeout: 3000 });
    const text = await preBlock.textContent();
    expect(text).toContain('codetrellis');
  });
});
