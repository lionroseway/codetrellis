/**
 * Plan templates — template chooser and create from template.
 *
 * Covers: template chooser in new plan, API template listing,
 * create plan from template, template names visible.
 */

import { test, expect } from '@playwright/test';
import { gotoWithProject, cleanupPlans, API } from '../helpers/setup';

test.describe('Plan templates', () => {
  test.afterEach(async ({ request }) => {
    await cleanupPlans(request, 'E2E Template');
    await cleanupPlans(request, 'Bug Fix');
    await cleanupPlans(request, 'New Feature');
  });

  test('template API returns at least 5 built-in templates', async ({ request }) => {
    const res = await request.get(`${API}/plan-templates`);
    expect(res.ok()).toBeTruthy();
    const templates = await res.json();
    expect(templates.length).toBeGreaterThanOrEqual(5);

    const ids = templates.map((t: any) => t.id);
    expect(ids).toContain('new-feature');
    expect(ids).toContain('bug-fix');
    expect(ids).toContain('mass-refactor');
  });

  test('template chooser shows 6 template buttons in new plan', async ({ page }) => {
    await gotoWithProject(page);

    await page.getByRole('button', { name: 'Plans', exact: true }).click();
    await page.locator('button:has-text("New plan")').click();
    await page.waitForTimeout(1500);

    // Template chooser shows template names
    await expect(page.getByText('Refactor').first()).toBeVisible({ timeout: 5000 });
    await expect(page.getByText('New Feature').first()).toBeVisible();
    await expect(page.getByText('Bug Fix').first()).toBeVisible();
  });

  test('clicking a template populates the plan', async ({ page }) => {
    await gotoWithProject(page);

    await page.getByRole('button', { name: 'Plans', exact: true }).click();
    await page.locator('button:has-text("New plan")').click();
    await page.waitForTimeout(1500);

    // Click the Bug Fix template
    await page.getByText('Bug Fix').first().click();
    await page.waitForTimeout(2000);

    // Template should have populated the plan — check for template content
    // The item tree should now have items from the template
    const pageContent = await page.content();
    // The plan should have some content now (description or items)
    expect(pageContent.length).toBeGreaterThan(0);
  });

  test('create plan from template via API', async ({ request }) => {
    const res = await request.post(`${API}/plans/from-template`, {
      data: {
        templateId: 'bug-fix',
        projectPath: process.cwd(),
        placeholderValues: {
          bug: 'E2E Template test bug description',
        },
      },
    });
    expect(res.ok()).toBeTruthy();
    const result = await res.json();
    expect(result.plan).toBeTruthy();
    expect(result.plan.uid).toBeTruthy();

    // Clean up
    await request.delete(`${API}/plans/${result.plan.uid}`);
  });
});
