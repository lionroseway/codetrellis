/**
 * Plan templates — template chooser and create from template.
 *
 * Covers: template chooser in new plan, API template listing,
 * create plan from template, template names visible.
 */

import { test, expect } from '@playwright/test';
import { gotoWithProject, cleanupPlans, openPlan, authHeaders, API } from '../helpers/setup';

const RUN = Math.random().toString(36).slice(2, 7);

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

  test('the empty-plan chooser lists the backend templates, playbooks included', async ({ page }) => {
    await gotoWithProject(page);

    await page.getByRole('button', { name: 'Plans', exact: true }).click();
    await page.locator('button:has-text("New plan")').click();

    // One registry (Phase 31 §14): what "New plan from template" offers is
    // what an empty plan offers, including the analysis-report playbook.
    const chooser = page.getByTestId('plan-template-chooser');
    await expect(chooser.getByText('Analysis report')).toBeVisible({ timeout: 10_000 });
    await expect(chooser.getByText('Refactor', { exact: true })).toBeVisible();
    await expect(chooser.getByText('New feature')).toBeVisible();
    await expect(chooser.getByText('Bug fix')).toBeVisible();
  });

  test('a playbook fills the plan with its steps, and each step with its criteria', async ({ page, request }) => {
    const title = `E2E Template Playbook ${RUN}`;
    const created = await request.post(`${API}/plans`, {
      headers: authHeaders(),
      data: { title, description: '', projectPath: process.cwd() },
    });
    expect(created.ok()).toBeTruthy();
    const plan = await created.json();

    await gotoWithProject(page);
    await openPlan(page, title);

    const chooser = page.getByTestId('plan-template-chooser');
    await chooser.getByText('Analysis report').click();
    // It has placeholders, so it asks for them before filling anything.
    await chooser.getByLabel('Report').fill('Board pack');
    await chooser.getByLabel('Period').fill('Q3 2026');
    await Promise.all([
      page.waitForResponse((r) => r.url().includes(`/plans/${plan.uid}/apply-template`) && r.ok()),
      chooser.getByRole('button', { name: 'Use this template' }).click(),
    ]);

    const tree = page.getByTestId('plan-item-tree');
    for (const step of ['Gather', 'Analyse', 'Draft', 'Review']) {
      await expect(tree.getByText(step, { exact: true })).toBeVisible({ timeout: 10_000 });
    }

    // The criteria came with the steps, placeholders filled, none decided.
    const itemsRes = await request.get(`${API}/plans/${plan.uid}/items`, { headers: authHeaders() });
    const items = (await itemsRes.json()) as Array<{ uid: string; title: string }>;
    const gather = items.find((i) => i.title === 'Gather')!;
    const criteria = await (await request.get(`${API}/items/${gather.uid}/criteria`, { headers: authHeaders() })).json();
    expect(criteria.map((c: { text: string; state: string }) => [c.text, c.state])).toEqual([
      ['Every source file used for Q3 2026 is recorded as a material', 'open'],
    ]);
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
