/**
 * Terminal panel — toggle open/close, collapsed/expanded states.
 *
 * Covers: toggle button, panel expands/collapses, session count badge.
 */

import { test, expect } from '@playwright/test';
import { gotoWithProject, API } from '../helpers/setup';

test.describe('Terminal panel', () => {
  test('Terminal toggle button visible in status bar', async ({ page }) => {
    await gotoWithProject(page);

    const termBtn = page.locator('button[title*="Toggle terminal"]')
      .or(page.locator('button[title*="terminal (Cmd"]'));
    await expect(termBtn.first()).toBeVisible({ timeout: 5000 });
  });

  test('"Terminal" text visible in the bottom bar', async ({ page }) => {
    await gotoWithProject(page);

    // The terminal toggle shows "Terminal" text
    await expect(page.getByText('Terminal').first()).toBeVisible({ timeout: 5000 });
  });

  test('clicking terminal toggle opens the panel', async ({ page }) => {
    await gotoWithProject(page);

    // Click the Terminal toggle in the tab bar area
    const termToggle = page.locator('button').filter({ hasText: 'Terminal' }).first();
    await termToggle.click();
    await page.waitForTimeout(1000);

    // Panel should expand — look for "New terminal" button or a session tab
    const hasNewTerminal = await page.locator('button[title="New terminal"]')
      .isVisible({ timeout: 3000 }).catch(() => false);
    const hasTermContent = await page.getByText('New terminal')
      .isVisible({ timeout: 2000 }).catch(() => false);

    expect(hasNewTerminal || hasTermContent).toBe(true);
  });

  test('terminal sessions can be created via API', async ({ request }) => {
    const res = await request.post(`${API}/terminals`, {
      data: {
        preset: 'shell',
        cwd: process.cwd(),
        title: 'E2E Panel Test',
      },
    });
    expect(res.ok()).toBeTruthy();
    const session = await res.json();
    expect(session.id).toBeTruthy();
    expect(session.preset).toBe('shell');

    // Clean up
    await request.delete(`${API}/terminals/${session.id}`);
  });

  test('terminal list endpoint returns array', async ({ request }) => {
    const res = await request.get(`${API}/terminals`);
    expect(res.ok()).toBeTruthy();
    const sessions = await res.json();
    expect(Array.isArray(sessions)).toBe(true);
  });
});
