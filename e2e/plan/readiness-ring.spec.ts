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

  // It showed a coloured percentage ("44%" in red on every new draft). It
  // says what is left in words now (Phase 32 §0.5), and the title counts
  // the required checks rather than giving a score.
  test('readiness says what is left before hand-off, in words', async ({ page, request }) => {
    await seedPlan(request, {
      title: PLAN_TITLE,
      actions: [{ title: 'Readiness Action', body: 'Body' }],
    });

    await gotoWithProject(page);
    await openPlan(page, PLAN_TITLE);

    // One task and no target: the required "Tasks have targets" check fails.
    const ring = page.getByTestId('plan-readiness');
    await expect(ring).toContainText('1 to do before hand-off');
    expect(await ring.getAttribute('title')).toMatch(/\d+ of \d+ required checks pass/);
    await expect(ring).not.toContainText('%');
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
    const hasRequired = await page.getByText('Required').first().waitFor({ state: 'visible', timeout: 2000 }).then(() => true)
      .catch(() => false);
    const hasSuggested = await page.getByText('Suggested').first().waitFor({ state: 'visible', timeout: 2000 }).then(() => true)
      .catch(() => false);

    expect(hasRequired || hasSuggested).toBe(true);
  });
});
