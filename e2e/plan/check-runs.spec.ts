/**
 * Phase 31 §8.3 — "Run checks" on the plan page.
 *
 * A person runs the plan's checks and reads what moved since the last run.
 * The first run says so; a second, after nothing changed, says that — the
 * difference is the headline, not the list.
 */

import { test, expect } from '@playwright/test';
import { gotoWithProject, seedPlan, openPlan, cleanupPlans, API } from '../helpers/setup';

test.describe('Run checks', () => {
  const planTitle = () => `E2E Check Runs ${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;

  test.afterEach(async ({ request }) => {
    await cleanupPlans(request, 'E2E Check Runs');
  });

  test('a person runs the checks and reads what moved since the last run', async ({ page, request }) => {
    const PLAN_TITLE = planTitle();
    const plan = await seedPlan(request, { title: PLAN_TITLE, actions: [{ title: 'Board deck', body: 'Build it.' }] });
    const add = await request.post(`${API}/items/${plan.actionUids[0]}/criteria`, {
      data: { text: 'Reads well to the board', kind: 'manual' },
    });
    expect(add.ok(), `add criterion -> ${add.status()}`).toBeTruthy();

    await gotoWithProject(page);
    await openPlan(page, PLAN_TITLE);

    const panel = page.getByTestId('check-run-panel');
    await expect(panel).toBeVisible({ timeout: 10_000 });
    await expect(panel.getByText('never run')).toBeVisible();

    await panel.getByRole('button', { name: 'Run checks' }).click();
    await expect(panel.getByTestId('check-run-since')).toHaveText('First check run on this plan.', { timeout: 10_000 });
    await expect(panel.getByText(/all 1 hold/)).toBeVisible();

    await panel.getByRole('button', { name: 'Run checks' }).click();
    await expect(panel.getByTestId('check-run-since')).toHaveText(/^Nothing changed since /, { timeout: 10_000 });

    const runs = await (await request.get(`${API}/plans/${plan.uid}/check-runs`)).json();
    expect(runs).toHaveLength(2);
    expect(runs[0].byType).toBe('human');
  });
});
