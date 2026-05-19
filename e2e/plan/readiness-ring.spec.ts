/**
 * Readiness ring — SVG ring in workspace header.
 *
 * Covers: ring renders, percentage display, expandable checklist,
 * required vs suggested checks.
 */

import { test, expect } from '@playwright/test';
import { gotoWithProject, seedPlan, openPlan, cleanupPlans } from '../helpers/setup';

test.describe('Readiness ring', () => {
  const PLAN_TITLE = 'E2E Readiness Ring Plan';

  test.afterEach(async ({ request }) => {
    await cleanupPlans(request, 'E2E Readiness');
  });

  test('readiness ring element is present in workspace header', async ({ page, request }) => {
    await seedPlan(request, {
      title: PLAN_TITLE,
      actions: [{ title: 'Action for readiness', body: 'Body' }],
    });

    await gotoWithProject(page);
    await openPlan(page, PLAN_TITLE);

    // Readiness ring has a title attribute describing readiness percentage
    const ring = page.locator('[title*="Plan readiness"]');
    await expect(ring).toBeVisible({ timeout: 5000 });
  });

  test('readiness ring shows a percentage', async ({ page, request }) => {
    await seedPlan(request, {
      title: PLAN_TITLE,
      actions: [{ title: 'Readiness Action', body: 'Body' }],
    });

    await gotoWithProject(page);
    await openPlan(page, PLAN_TITLE);

    // The ring title contains the percentage
    const ring = page.locator('[title*="Plan readiness"]');
    const title = await ring.getAttribute('title');
    expect(title).toMatch(/\d+%/);
  });

  test('clicking readiness ring expands checklist', async ({ page, request }) => {
    await seedPlan(request, {
      title: PLAN_TITLE,
      actions: [{
        title: 'Checklist Action',
        body: 'Body',
        fileSpecs: [{ path: 'src/backend/server.ts', action: 'modify' }],
      }],
    });

    await gotoWithProject(page);
    await openPlan(page, PLAN_TITLE);

    const ring = page.locator('[title*="Plan readiness"]');
    await ring.click();
    await page.waitForTimeout(500);

    // Checklist should expand — look for "Required" or "Suggested" headers
    const hasRequired = await page.getByText('Required').first().isVisible({ timeout: 2000 })
      .catch(() => false);
    const hasSuggested = await page.getByText('Suggested').first().isVisible({ timeout: 2000 })
      .catch(() => false);

    expect(hasRequired || hasSuggested).toBe(true);
  });
});
