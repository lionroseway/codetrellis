/**
 * Per-test results, from the window (Phase 32 B8.1).
 *
 * Priya's task "Fix VAT rounding" has a test criterion, and the agent
 * recorded its JUnit report. She runs the plan's checks: the Checks panel
 * says which tests fail, by name, with the first line of why — not only "1
 * of 2 tests failing". The report is a real file read by the real backend;
 * CodeTrellis runs nothing.
 */

import fs from 'node:fs';
import path from 'node:path';
import { test, expect } from '@playwright/test';
import { API, PROJECT_PATH, authHeaders, gotoWithProject, openPlan, seedPlan, cleanupPlans } from '../helpers/setup';

const OUT = path.join('test-results', 'ux-audit');
const PLAN = 'E2E B8.1 billing fixes';
const REPORT = path.join('test-results', 'b8-junit.xml');

test.describe('Per-test results', () => {
  test.afterEach(async ({ request }) => {
    await cleanupPlans(request, PLAN);
    fs.rmSync(path.join(PROJECT_PATH, REPORT), { force: true });
  });

  test('the Checks panel names the failing tests, with why', async ({ page, request }) => {
    fs.mkdirSync(path.join(PROJECT_PATH, 'test-results'), { recursive: true });
    fs.writeFileSync(path.join(PROJECT_PATH, REPORT), `<testsuites><testsuite name="vat">
<testcase classname="VatTest" name="rounds per line"><failure message="expected 2.40 to be 2.41"/></testcase>
<testcase classname="VatTest" name="sums lines"/>
</testsuite></testsuites>`);
    const plan = await seedPlan(request, { title: PLAN, actions: [{ title: 'Fix VAT rounding' }] });
    const item = plan.actionUids[0];
    const art = await request.post(`${API}/items/${item}/artefacts`, { headers: authHeaders(), data: { path: REPORT, role: 'evidence' } });
    expect(art.ok(), await art.text()).toBeTruthy();
    expect((await request.post(`${API}/items/${item}/criteria`, { headers: authHeaders(), data: { text: 'VAT tests pass', kind: 'test' } })).ok()).toBeTruthy();

    await gotoWithProject(page);
    await openPlan(page, PLAN);
    const panel = page.getByTestId('check-run-panel');
    await panel.getByRole('button', { name: 'Run checks' }).click();
    await expect(panel.getByText('1 need attention')).toBeVisible({ timeout: 10_000 });
    const toggle = panel.locator('button[aria-expanded]');
    if ((await toggle.getAttribute('aria-expanded')) !== 'true') await toggle.click();
    await expect(panel).toContainText(`${REPORT} reports 1 of 2 tests failing: VatTest › rounds per line (expected 2.40 to be 2.41)`);
    fs.mkdirSync(OUT, { recursive: true });
    await panel.screenshot({ path: path.join(OUT, 'test-results-checks.png') });

    // The window's read says the same, test by test.
    const listed = await (await request.get(`${API}/tests?project=${encodeURIComponent(PROJECT_PATH)}&match=VatTest`, { headers: authHeaders() })).json();
    expect(listed.tests.map((t: { label: string; result: string }) => [t.label, t.result])).toEqual([['VatTest › rounds per line', 'failed'], ['VatTest › sums lines', 'passed']]);
  });
});
