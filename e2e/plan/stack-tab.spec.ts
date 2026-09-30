/**
 * Phase 32 B6.4 — the Stack tab: every plan under way at once (JOURNEYS H1).
 *
 * Billing and Exports both name `src/backend/server.ts`, so each says it
 * overlaps the other. "Deploy exports" waits on Billing's "Migrate schema",
 * and says so with a link that opens it. "Show on graph" draws Billing's
 * footprint on the graph, and a second press takes it off.
 */
import fs from 'node:fs';
import path from 'node:path';
import { test, expect, type Page } from '@playwright/test';
import { API, authHeaders, cleanupPlans, gotoWithProject, seedPlan } from '../helpers/setup';

const OUT = path.join('test-results', 'ux-audit');
const BILLING = 'E2E Stack Billing';
const EXPORTS = 'E2E Stack Exports';
const SHARED_FILE = 'src/backend/server.ts';

async function shot(page: Page, name: string) {
  fs.mkdirSync(OUT, { recursive: true });
  await page.waitForTimeout(300);
  await page.screenshot({ path: path.join(OUT, `${name}.png`) });
}

test.describe('The Stack tab', () => {
  test.afterEach(async ({ request }) => { await cleanupPlans(request, 'E2E Stack'); });

  test('every plan at once: overlaps in words, a wait across plans that leads there, a footprint on the graph', async ({ page, request }) => {
    const billing = await seedPlan(request, {
      title: BILLING,
      actions: [{ title: 'Migrate schema', fileSpecs: [{ path: SHARED_FILE, action: 'modify' }] }],
    });
    const exportsPlan = await seedPlan(request, {
      title: EXPORTS,
      actions: [{ title: 'Deploy exports', fileSpecs: [{ path: SHARED_FILE, action: 'modify' }] }],
    });
    const [migrate] = billing.actionUids;
    const [deploy] = exportsPlan.actionUids;
    expect((await request.put(`${API}/items/${deploy}`, { headers: authHeaders(), data: { dependencies: [migrate] } })).ok()).toBeTruthy();

    await gotoWithProject(page);
    await page.getByRole('button', { name: 'Stack', exact: true }).first().click();
    await expect(page.getByTestId('stack-tab')).toBeVisible({ timeout: 10_000 });

    const billingRow = page.locator(`[data-testid="stack-plan"][data-plan-uid="${billing.uid}"]`);
    const exportsRow = page.locator(`[data-testid="stack-plan"][data-plan-uid="${exportsPlan.uid}"]`);
    await expect(billingRow).toBeVisible({ timeout: 10_000 });
    await expect(exportsRow).toBeVisible();

    // Where they meet, in words, from each side.
    await expect(exportsRow.getByTestId('stack-overlap')).toHaveText(`⚠ overlaps ${BILLING}`);
    await expect(billingRow.getByTestId('stack-overlap')).toHaveText(`⚠ overlaps ${EXPORTS}`);
    await expect(exportsRow.getByTestId('stack-overlap')).toHaveAttribute('title', `Both plan to change ${SHARED_FILE}.`);

    // The wait across plans, in words.
    await expect(exportsRow.getByTestId('stack-dependency')).toHaveText(`↑ waits on “Migrate schema” in plan “${BILLING}”`);
    await exportsRow.scrollIntoViewIfNeeded();
    await shot(page, 'stack-tab');

    // Show Billing on the graph: its footprint is highlighted.
    await billingRow.getByTestId('stack-show-on-graph').click();
    await expect(billingRow.getByTestId('stack-show-on-graph')).toHaveAttribute('aria-pressed', 'true');
    await expect(billingRow.getByTestId('stack-show-on-graph')).toHaveText(/On the graph/);
    await expect.poll(() => page.locator('[data-plan-highlighted]').count(), { timeout: 20_000 }).toBeGreaterThan(0);
    await shot(page, 'stack-on-graph');

    // And off again.
    await billingRow.getByTestId('stack-show-on-graph').click();
    await expect(billingRow.getByTestId('stack-show-on-graph')).toHaveAttribute('aria-pressed', 'false');
    await expect.poll(() => page.locator('[data-plan-highlighted]').count(), { timeout: 10_000 }).toBe(0);

    // The link opens the task it waits on, in its own plan.
    await exportsRow.getByTestId('stack-dependency-link').click();
    await expect(page.getByTestId('copy-ref-plan')).toBeVisible({ timeout: 10_000 });
    await expect(page.locator('input[placeholder="Untitled"]')).toHaveValue('Migrate schema', { timeout: 10_000 });
    await shot(page, 'stack-wait-opened');
  });

  test('once the other plan\'s task is done, the wait is gone and the dependency reads as met', async ({ page, request }) => {
    const billing = await seedPlan(request, { title: BILLING, actions: [{ title: 'Migrate schema' }] });
    const exportsPlan = await seedPlan(request, { title: EXPORTS, actions: [{ title: 'Deploy exports' }] });
    const put = (uid: string, data: unknown) => request.put(`${API}/items/${uid}`, { headers: authHeaders(), data });
    expect((await put(exportsPlan.actionUids[0], { dependencies: [billing.actionUids[0]] })).ok()).toBeTruthy();
    expect((await put(billing.actionUids[0], { status: 'done' })).ok()).toBeTruthy();

    await gotoWithProject(page);
    await page.getByRole('button', { name: 'Stack', exact: true }).first().click();
    const exportsRow = page.locator(`[data-testid="stack-plan"][data-plan-uid="${exportsPlan.uid}"]`);
    await expect(exportsRow).toBeVisible({ timeout: 10_000 });
    await expect(exportsRow.getByTestId('stack-dependency')).toHaveCount(0);
    await expect(exportsRow.getByTestId('stack-dependency-met')).toHaveText(`✓ after “Migrate schema” in ${BILLING}`);
    await expect(page.locator(`[data-testid="stack-plan"][data-plan-uid="${billing.uid}"]`)).toContainText('1/1');
  });
});
