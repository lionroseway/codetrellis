/**
 * Terminal empty state — "New terminal" button when no sessions.
 *
 * Covers: empty state renders, "New terminal" button visible.
 */

import { test, expect } from '@playwright/test';
import { gotoWithProject, API } from '../helpers/setup';

test.describe('Terminal empty state', () => {
  test.beforeEach(async ({ request }) => {
    // Ensure no terminal sessions exist
    const res = await request.get(`${API}/terminals`);
    if (res.ok()) {
      const sessions = await res.json();
      for (const s of sessions) {
        await request.delete(`${API}/terminals/${s.id}`);
      }
    }
  });

  test('empty terminal list returns empty array', async ({ request }) => {
    const res = await request.get(`${API}/terminals`);
    expect(res.ok()).toBeTruthy();
    const sessions = await res.json();
    expect(sessions.length).toBe(0);
  });

  test('"New terminal" button visible when panel opened with no sessions', async ({ page }) => {
    await gotoWithProject(page);

    // Open terminal panel
    // By its title: "a button containing Terminal" also matches the file
    // tree's e2e/terminal/ folder, which comes first in the page.
    const termToggle = page.locator('button[title^="Toggle terminal"]');
    await termToggle.click();
    await page.waitForTimeout(1000);

    // Empty state should show "New terminal" text
    await expect(page.getByText('New terminal').first()).toBeVisible({ timeout: 5000 });
  });
});
