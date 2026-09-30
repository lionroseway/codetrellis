/**
 * The plan already active reopens from its row (Phase 32, found while
 * tracing pr55-ui:431 on #224).
 *
 * The workspace opened only when the active plan CHANGED. So a plan that was
 * minimised, or navigated away from, stayed shut when its own row was
 * clicked; only the floating chip brought it back. A person clicking the
 * row they can see got nothing.
 */

import { test, expect } from '@playwright/test';
import { API, PROJECT_PATH, authHeaders, gotoWithProject, openPlan } from '../helpers/setup';

test('minimised, the active plan opens again from its row in the list', async ({ page, request }) => {
  await gotoWithProject(page);
  const title = `reopen-active ${Date.now()}`;
  const res = await request.post(`${API}/plans`, { headers: authHeaders(), data: { title, description: '', projectPath: PROJECT_PATH } });
  expect(res.ok(), `POST /api/plans -> ${res.status()}`).toBeTruthy();

  await openPlan(page, title);
  const workspace = page.getByTestId('copy-ref-plan').first();
  await expect(workspace).toBeVisible();

  // Minimise: the plan stays active, the graph shows.
  await page.getByTitle(/^Minimize plan workspace/).first().click();
  await expect(workspace).toBeHidden();

  // Its own row opens it again.
  await page.getByRole('button', { name: 'Plans', exact: true }).first().click();
  const row = page.getByTitle('Click to open the plan workspace').filter({ hasText: title }).first();
  await expect(row).toContainText('Open');
  await row.click();
  await expect(workspace).toBeVisible();
});
