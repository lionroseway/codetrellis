/**
 * Phase 32 B6.1 — a task waiting on another plan's task says so, and leads
 * there (bug 11).
 *
 * "Deploy exports" depends on "Migrate schema" in another plan. The plan's
 * home page used to say "1 action waiting on something unfinished" for ever,
 * even after Migrate was done: the count only looked in the open plan. Now it
 * names the task and the plan, the name opens that task, and once it is done
 * the dependant is Next up.
 */
import fs from 'node:fs';
import path from 'node:path';
import { test, expect, type Page } from '@playwright/test';
import { API, authHeaders, cleanupPlans, gotoWithProject, openPlan, seedPlan } from '../helpers/setup';

const OUT = path.join('test-results', 'ux-audit');
const BILLING = 'E2E Cross-plan Billing';
const EXPORTS = 'E2E Cross-plan Exports';

async function shot(page: Page, name: string) {
  fs.mkdirSync(OUT, { recursive: true });
  await page.waitForTimeout(300);
  await page.screenshot({ path: path.join(OUT, `${name}.png`) });
}

test.describe('A task waiting on another plan', () => {
  test.afterEach(async ({ request }) => { await cleanupPlans(request, 'E2E Cross-plan'); });

  test('says what it waits on and where, opens it, and is next once it is done', async ({ page, request }) => {
    const billing = await seedPlan(request, { title: BILLING, actions: [{ title: 'Migrate schema' }] });
    const exportsPlan = await seedPlan(request, { title: EXPORTS, actions: [{ title: 'Deploy exports' }] });
    const [migrate] = billing.actionUids;
    const [deploy] = exportsPlan.actionUids;
    const put = (uid: string, data: unknown) => request.put(`${API}/items/${uid}`, { headers: authHeaders(), data });
    expect((await put(deploy, { dependencies: [migrate] })).ok()).toBeTruthy();

    await gotoWithProject(page);
    await openPlan(page, EXPORTS);

    const waiting = page.getByTestId('next-up-waiting');
    await expect(waiting).toBeVisible({ timeout: 10_000 });
    await expect(waiting).toContainText('Nothing is ready to start');
    await expect(page.getByTestId('next-up-wait')).toHaveText(`“Deploy exports” waits on “Migrate schema” in plan “${BILLING}”`);
    await shot(page, 'cross-plan-waits');

    // The other plan's task is a link: it opens that plan with the task selected.
    await page.getByTestId('next-up-wait-link').click();
    await expect(page.getByTestId('copy-ref-plan')).toBeVisible();
    await expect(page.locator('textarea[placeholder="Untitled"]')).toHaveValue('Migrate schema', { timeout: 10_000 });
    await expect(page.getByText(BILLING).first()).toBeVisible();
    await shot(page, 'cross-plan-wait-opened');

    // Done there, so the dependant is next here.
    expect((await put(migrate, { status: 'done' })).ok()).toBeTruthy();
    await openPlan(page, EXPORTS);
    await expect(page.getByTestId('next-up-waiting')).toHaveCount(0, { timeout: 10_000 });
    await expect(page.getByText('Next up').first()).toBeVisible();
    await expect(page.getByRole('button', { name: /Next up\s*Deploy exports/ })).toBeVisible();
    await shot(page, 'cross-plan-wait-cleared');
  });
});
