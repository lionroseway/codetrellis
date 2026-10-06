/**
 * Phase 33 G5 — selecting a file says which plans and tasks touch it.
 *
 * The owner: "when click on a card being able to see if plan or otherwise".
 * The inspector fetched every plan's overlay for the file already, but said
 * so only as a count, and only after "View source". Now the plans and their
 * tasks are listed under the file's name, each task with its state in a
 * glyph and a word, and a task opens its plan at that task.
 */

import { test, expect } from '@playwright/test';
import { gotoWithProject, pickInExplorer, seedPlan, cleanupPlans } from '../helpers/setup';

const PREFIX = 'E2E File Plans';
const FILE = 'src/shared/types/agent.ts';

test.describe('Inspector: the plans that touch a file', () => {
  test.afterEach(async ({ request }) => {
    await cleanupPlans(request, PREFIX);
  });

  test('a file lists its plan and task with the task\'s state, and the task opens the plan there', async ({ page, request }) => {
    const title = `${PREFIX} ${Date.now()}`;
    await seedPlan(request, {
      title,
      actions: [
        { title: 'Name the agent kinds', fileSpecs: [{ path: FILE, action: 'modify' }] },
        { title: 'Elsewhere entirely', fileSpecs: [{ path: 'src/shared/types/plan.ts', action: 'modify' }] },
      ],
    });

    await gotoWithProject(page);
    await pickInExplorer(page, FILE);

    const plans = page.getByTestId('file-plans');
    // Shown without opening the source.
    await expect(plans).toBeVisible();
    await expect(page.getByText('View source')).toBeVisible();
    const mine = plans.locator('li', { hasText: title }).first();
    await expect(mine).toBeVisible({ timeout: 10_000 });
    const task = mine.getByTestId('file-plan-task');
    await expect(task).toHaveCount(1);
    await expect(task).toContainText('○');
    await expect(task).toContainText('Name the agent kinds');
    await expect(task).toContainText('not started');

    await task.click();
    await expect(page.getByTestId('copy-ref-plan').first()).toBeVisible({ timeout: 10_000 });
    await expect(page.getByText('Name the agent kinds').first()).toBeVisible();
  });

  test('a file no plan touches says so, quietly', async ({ page }) => {
    await page.route('**/api/file/overlay?*', (route) => route.fulfill({
      status: 200, contentType: 'application/json',
      body: JSON.stringify({ markers: [], fileLevel: [], unanchored: [], itemCount: 0 }),
    }));
    await gotoWithProject(page);
    await pickInExplorer(page, FILE);
    await expect(page.getByTestId('file-plans')).toContainText('No plan touches this file.');
    await expect(page.getByTestId('file-plan-task')).toHaveCount(0);
  });
});
