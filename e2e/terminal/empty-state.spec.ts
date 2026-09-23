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

  // Opening the panel with no sessions starts a shell (terminal-store's
  // togglePanel), so the empty state is what you see after closing the
  // last one — not on first open, which is what this used to expect.
  test('"New terminal" shows once the last session is closed', async ({ page, request }) => {
    await gotoWithProject(page);

    await page.locator('button[title^="Toggle terminal"]').click();
    const close = page.getByRole('button', { name: /^Close Terminal/ }).first();
    await expect(close).toBeAttached({ timeout: 10_000 });

    await close.click({ force: true }); // it only shows on hover
    await expect(page.getByText('New terminal').first()).toBeVisible({ timeout: 5000 });

    // Nothing left running for the next spec.
    const left = await (await request.get(`${API}/terminals`)).json();
    expect(left.length).toBe(0);
  });
});
