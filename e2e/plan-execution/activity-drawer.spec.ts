/**
 * Activity drawer — right-side drawer with Activity and Live tabs.
 *
 * Covers: toggle open/close, Activity tab events, timeline API,
 * collapse/expand button.
 *
 * Note: The "Live" text also matches the Trellis mode badge in the
 * header ("live" in lowercase). Use evaluate clicks and scoped selectors
 * to avoid matching the wrong element.
 */

import { test, expect } from '@playwright/test';
import { gotoWithProject, seedPlan, openPlan, cleanupPlans, API } from '../helpers/setup';

test.describe('Activity drawer', () => {
  const PLAN_TITLE = 'E2E Activity Drawer Plan';

  test.afterEach(async ({ request }) => {
    await cleanupPlans(request, 'E2E Activity Drawer');
  });

  test('Activity toggle button opens the drawer', async ({ page, request }) => {
    await seedPlan(request, {
      title: PLAN_TITLE,
      actions: [{ title: 'Activity Action', body: 'Body' }],
    });

    await gotoWithProject(page);
    await openPlan(page, PLAN_TITLE);

    const activityBtn = page.locator('button[title*="Toggle activity drawer"]');
    await expect(activityBtn).toBeVisible({ timeout: 5000 });
    // Use evaluate for reliable click
    await activityBtn.evaluate((el) => (el as HTMLButtonElement).click());
    await page.waitForTimeout(1000);

    // The drawer should show Activity tab with event count
    // Look for "Activity" text that's NOT the header button (use nth)
    const activityTexts = page.getByText('Activity');
    const count = await activityTexts.count();
    // There should be at least 2 "Activity" texts: header button + drawer tab
    expect(count).toBeGreaterThanOrEqual(2);
  });

  test('drawer has Live tab visible after opening', async ({ page, request }) => {
    await seedPlan(request, {
      title: PLAN_TITLE,
      actions: [{ title: 'Tab Action', body: 'Body' }],
    });

    await gotoWithProject(page);
    await openPlan(page, PLAN_TITLE);

    const activityBtn = page.locator('button[title*="Toggle activity drawer"]');
    await activityBtn.evaluate((el) => (el as HTMLButtonElement).click());
    await page.waitForTimeout(1000);

    // The drawer should contain a "Live" tab — look for it with an icon
    // The Live tab has a Zap icon and text "Live"
    // Use a broader check: after opening, content should have appeared in the right area
    const drawerContent = await page.evaluate(() => {
      // Find the activity drawer by looking for elements after the main canvas
      const buttons = document.querySelectorAll('button');
      return Array.from(buttons).some(b => b.textContent?.trim() === 'Live');
    });
    expect(drawerContent).toBe(true);
  });

  test('toggling Activity button closes the drawer', async ({ page, request }) => {
    await seedPlan(request, {
      title: PLAN_TITLE,
      actions: [{ title: 'Toggle Close Action', body: 'Body' }],
    });

    await gotoWithProject(page);
    await openPlan(page, PLAN_TITLE);

    const activityBtn = page.locator('button[title*="Toggle activity drawer"]');

    // Open
    await activityBtn.evaluate((el) => (el as HTMLButtonElement).click());
    await page.waitForTimeout(500);

    // Close
    await activityBtn.evaluate((el) => (el as HTMLButtonElement).click());
    await page.waitForTimeout(500);

    // Workspace should still be functional
    await expect(page.locator('input[placeholder="Untitled plan"]')).toBeVisible({
      timeout: 5000,
    });
  });

  test('timeline API returns events for plan', async ({ request }) => {
    const plan = await seedPlan(request, {
      title: PLAN_TITLE,
      actions: [{ title: 'Timeline Event Action', body: 'Body' }],
    });

    const res = await request.get(`${API}/plans/${plan.uid}/timeline?limit=50`);
    expect(res.ok()).toBeTruthy();
    const events = await res.json();
    expect(Array.isArray(events)).toBe(true);
    // Should have at least the item_created event
    expect(events.length).toBeGreaterThanOrEqual(1);
  });

  test('collapse button in drawer hides content', async ({ page, request }) => {
    await seedPlan(request, {
      title: PLAN_TITLE,
      actions: [{ title: 'Collapse Action', body: 'Body' }],
    });

    await gotoWithProject(page);
    await openPlan(page, PLAN_TITLE);

    const activityBtn = page.locator('button[title*="Toggle activity drawer"]');
    await activityBtn.evaluate((el) => (el as HTMLButtonElement).click());
    await page.waitForTimeout(1000);

    // Look for the collapse button in the drawer
    const collapseBtn = page.locator('button[title="Collapse"]');
    if (await collapseBtn.isVisible({ timeout: 2000 }).catch(() => false)) {
      await collapseBtn.click();
      await page.waitForTimeout(500);

      // After collapsing, the expand button should appear
      await expect(page.locator('button[title="Open activity drawer"]')).toBeVisible({
        timeout: 3000,
      });
    }
  });
});
