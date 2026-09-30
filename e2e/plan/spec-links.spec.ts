/**
 * Phase 32 B7.1 — a task says what spec it relies on, and a page who relies
 * on it (JOURNEYS I1).
 *
 * "Add currency" in Billing relies on the Fields section of "Invoice format",
 * a page in the spec plan; "Export invoices" relies on the whole page. The
 * task's page says "Relies on: Invoice format › Fields", and that opens the
 * page. The page says "Relied on by 2 tasks in 2 plans" and names them; a
 * name opens its task. When a change to Fields is proposed (B7.2), the page
 * says so, with why and who it affects, and is not changed.
 */
import fs from 'node:fs';
import path from 'node:path';
import { test, expect, type Page } from '@playwright/test';
import { API, authHeaders, cleanupPlans, gotoWithProject, openPlan, seedPlan } from '../helpers/setup';

const OUT = path.join('test-results', 'ux-audit');
const SPEC = 'E2E Spec links Invoicing';
const BILLING = 'E2E Spec links Billing';
const EXPORTS = 'E2E Spec links Exports';
const BODY = '# Invoice format\n\nAn invoice is JSON.\n\n## Fields\n\n- amount\n\n## Totals\n\nSum of lines.\n';

async function shot(page: Page, name: string) {
  fs.mkdirSync(OUT, { recursive: true });
  await page.waitForTimeout(300);
  await page.screenshot({ path: path.join(OUT, `${name}.png`) });
}

test.describe('Spec links', () => {
  test.afterEach(async ({ request }) => { await cleanupPlans(request, 'E2E Spec links'); });

  test('a task shows the section it relies on and opens it; the page names who relies on it', async ({ page, request }) => {
    const spec = await seedPlan(request, { title: SPEC });
    const made = await request.post(`${API}/plans/${spec.uid}/items`, { headers: authHeaders(), data: { kind: 'object', title: 'Invoice format', body: BODY } });
    expect(made.ok()).toBeTruthy();
    const pageUid = ((await made.json()) as { uid: string }).uid;
    const billing = await seedPlan(request, { title: BILLING, actions: [{ title: 'Add currency' }] });
    const exportsPlan = await seedPlan(request, { title: EXPORTS, actions: [{ title: 'Export invoices' }] });
    const relies = (uid: string, reliesOn: unknown) => request.put(`${API}/items/${uid}/relies-on`, { headers: authHeaders(), data: { reliesOn } });
    expect((await relies(billing.actionUids[0], [{ page: pageUid, section: 'fields' }])).ok()).toBeTruthy();
    expect((await relies(exportsPlan.actionUids[0], [{ page: pageUid }])).ok()).toBeTruthy();

    await gotoWithProject(page);
    await openPlan(page, BILLING);
    await page.getByText('Add currency', { exact: true }).first().click();

    const reliesOn = page.getByTestId('spec-relies-on');
    await expect(reliesOn).toBeVisible({ timeout: 10_000 });
    await expect(reliesOn).toContainText('Relies on:');
    await expect(page.getByTestId('spec-relies-on-link')).toHaveText('Invoice format › Fields');
    await shot(page, 'spec-relies-on');

    // The link opens the page, in its own plan, and the page names who relies on it.
    await page.getByTestId('spec-relies-on-link').click();
    await expect(page.locator('input[placeholder="Untitled"]')).toHaveValue('Invoice format', { timeout: 10_000 });
    await expect(page.getByTestId('spec-relied-on-words')).toHaveText('Relied on by 2 tasks in 2 plans');
    const tasks = page.getByTestId('spec-relied-on-task');
    await expect(tasks).toHaveText(['Add currency', 'Export invoices']);
    await expect(page.getByTestId('spec-relied-on-by')).toContainText('§ Fields');
    await expect(page.getByTestId('spec-relied-on-by')).toContainText('the whole page');
    await shot(page, 'spec-relied-on-by');

    // B7.2: an agent proposes a change to Fields; the page says so while it is open, and is unchanged.
    const proposed = await request.post(`${API}/items/${pageUid}/spec-proposals`, {
      headers: authHeaders(),
      data: { section: 'fields', text: '## Fields\n\n- amount\n- currency (ISO 4217, required)', why: 'Amounts are ambiguous for EU customers.', evidence: { tests: ['invoice_eu.spec'] } },
    });
    expect(proposed.ok()).toBeTruthy();
    const card = page.getByTestId('spec-proposal');
    await expect(card).toBeVisible({ timeout: 10_000 });
    await expect(card).toContainText('Spec change proposed');
    await expect(card).toContainText('to § Fields');
    await expect(card).toContainText('Why: Amounts are ambiguous for EU customers.');
    await expect(card).toContainText('2 tasks in 2 plans rely on this. A person decides; the page is unchanged until then.');
    await expect(page.getByText('- currency (ISO 4217, required)')).toHaveCount(0);
    await shot(page, 'spec-proposed');

    // A name opens its task.
    await tasks.nth(1).click();
    await expect(page.locator('input[placeholder="Untitled"]')).toHaveValue('Export invoices', { timeout: 10_000 });
  });
});
