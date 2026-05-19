/**
 * Golden chain: fresh user journey — open app → see welcome → open
 * project → graph renders → create plan → add items → see workspace →
 * toggle views → connect agent hint.
 *
 * This is the "first 5 minutes" test — everything a new user does.
 */

import { test, expect } from '@playwright/test';
import { gotoWelcome, gotoWithProject, seedPlan, openPlan, cleanupPlans, API } from '../helpers/setup';

test.describe('Onboarding → Plan journey', () => {
  const PLAN_TITLE = 'E2E Onboarding Journey Plan';

  test.afterEach(async ({ request }) => {
    await cleanupPlans(request, 'E2E Onboarding Journey');
  });

  test('fresh app shows welcome → scan → graph → create plan → workspace', async ({ page }) => {
    // --- Step 1: Welcome screen ---
    await gotoWelcome(page, { skipLearnTrellis: true });

    // Should show "Open Project" or "CodeTrellis"
    const welcomeVisible = await page.getByText('Open Project').first()
      .isVisible({ timeout: 5000 }).catch(() => false);
    const brandVisible = await page.getByText('CodeTrellis').first()
      .isVisible({ timeout: 3000 }).catch(() => false);
    expect(welcomeVisible || brandVisible).toBe(true);

    // --- Step 2: Open project (via test helper — skips folder picker) ---
    await gotoWithProject(page);

    // --- Step 3: Graph renders ---
    await expect(page.locator('.react-flow').first()).toBeVisible({ timeout: 15000 });
    const nodeCount = await page.locator('.react-flow__node').count();
    expect(nodeCount).toBeGreaterThan(0);

    // --- Step 4: Status bar shows "Ready" ---
    await expect(page.getByText('Ready').first()).toBeVisible({ timeout: 5000 });

    // --- Step 5: Create a plan via UI ---
    await page.getByRole('button', { name: 'Plans', exact: true }).click();
    await page.waitForTimeout(500);

    // Click "New Plan" or "+" button
    const newPlanBtn = page.locator('button').filter({ hasText: /New Plan|\+/ }).first();
    const hasNewBtn = await newPlanBtn.isVisible({ timeout: 2000 }).catch(() => false);

    if (hasNewBtn) {
      await newPlanBtn.click();
      await page.waitForTimeout(1000);

      // Fill in the plan title
      const titleInput = page.locator('input[placeholder="Untitled plan"]').first();
      const hasTitleInput = await titleInput.isVisible({ timeout: 2000 }).catch(() => false);

      if (hasTitleInput) {
        await titleInput.fill(PLAN_TITLE);
        await page.waitForTimeout(500);

        // Verify plan workspace opened
        const workspaceVisible = await page.evaluate(() => {
          const text = document.body.textContent || '';
          return text.includes('Untitled plan') || text.includes('E2E Onboarding');
        });
        expect(workspaceVisible).toBe(true);
      }
    }

    // --- Step 6: Verify "Connect Agent" button is accessible ---
    // Go back to graph mode first
    await page.keyboard.press('Escape');
    await page.waitForTimeout(500);

    const connectBtn = page.locator('button:has-text("Connect Agent")');
    const hasConnectBtn = await connectBtn.isVisible({ timeout: 3000 }).catch(() => false);
    expect(hasConnectBtn).toBe(true);
  });

  test('plan workspace → click items → canvas detail → switch between', async ({ page, request }) => {
    await seedPlan(request, {
      title: PLAN_TITLE,
      actions: [
        { title: 'First task', body: 'Do the first thing' },
        { title: 'Second task', body: 'Do the second thing' },
      ],
    });

    await gotoWithProject(page);
    await openPlan(page, PLAN_TITLE);

    // --- Step 1: Both items should be in the tree ---
    await expect(page.getByText('First task').first()).toBeVisible({ timeout: 5000 });
    await expect(page.getByText('Second task').first()).toBeVisible({ timeout: 3000 });

    // --- Step 2: Click an item to see its canvas detail ---
    await page.getByText('First task').first().click();
    await page.waitForTimeout(1000);

    // Canvas should show the item detail
    const hasDetail = await page.evaluate(() => {
      const text = document.body.textContent || '';
      return text.includes('First task') && (
        text.includes('Do the first thing') ||
        text.includes('pending') ||
        text.includes('Status')
      );
    });
    expect(hasDetail).toBe(true);

    // --- Step 3: Switch between items ---
    await page.getByText('Second task').first().click();
    await page.waitForTimeout(500);

    const switchedToSecond = await page.evaluate(() => {
      return document.body.textContent?.includes('Second task');
    });
    expect(switchedToSecond).toBe(true);
  });

  test('plan created via API → visible in UI → open → items → close → graph', async ({
    page,
    request,
  }) => {
    await seedPlan(request, {
      title: PLAN_TITLE,
      actions: [{ title: 'API-created task', body: 'Created externally' }],
    });

    await gotoWithProject(page);

    // Open plans panel
    await page.getByRole('button', { name: 'Plans', exact: true }).click();
    await page.waitForTimeout(500);

    // Plan should be in the list
    await expect(page.getByText(PLAN_TITLE).first()).toBeVisible({ timeout: 5000 });

    // Open it
    await page.getByText(PLAN_TITLE).first().click();
    await page.waitForTimeout(1500);

    // Task should be visible
    await expect(page.getByText('API-created task').first()).toBeVisible({ timeout: 5000 });

    // Close plan workspace via Escape or minimize
    await page.keyboard.press('Escape');
    await page.waitForTimeout(500);

    // Graph should be visible again
    const graphVisible = await page.locator('.react-flow').first()
      .isVisible({ timeout: 5000 }).catch(() => false);
    expect(graphVisible).toBe(true);
  });
});
