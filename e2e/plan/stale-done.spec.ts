/**
 * "Done" on stale tests, from the window (Phase 32 B8.4a, JOURNEYS J1).
 *
 * Priya's agent ran the VAT tests, then changed vat.ts again and marked
 * "Fix VAT rounding" done on the old report. That was refused. Opening the
 * task, she sees why at a glance: the line above its criteria says "⚠ 1 with
 * tests older than the code", and hovering it names the report and when the
 * code changed. The files and the report are real, read by the real
 * backend; CodeTrellis runs nothing.
 */

import fs from 'node:fs';
import path from 'node:path';
import { test, expect } from '@playwright/test';
import { API, PROJECT_PATH, authHeaders, gotoWithProject, openPlan, seedPlan, cleanupPlans } from '../helpers/setup';
import { createMcpClient } from '../helpers/mcp-client';

const OUT = path.join('test-results', 'ux-audit');
const PLAN = 'E2E B8.4a billing fixes';
const CODE = 'test-results/b84a/vat.ts';
const REPORT = 'test-results/b84a/vat.xml';

test.describe('Done on tests older than the code', () => {
  test.afterEach(async ({ request }) => {
    await cleanupPlans(request, PLAN);
    fs.rmSync(path.join(PROJECT_PATH, 'test-results', 'b84a'), { recursive: true, force: true });
  });

  test('refused for the agent; the task says tests older than the code, and why', async ({ page, request }) => {
    const write = (rel: string, body: string, minutesAgo: number) => {
      const p = path.join(PROJECT_PATH, rel);
      fs.mkdirSync(path.dirname(p), { recursive: true });
      fs.writeFileSync(p, body);
      const t = new Date(Date.now() - minutesAgo * 60_000);
      fs.utimesSync(p, t, t);
    };
    write(REPORT, '<testsuites><testsuite name="vat"><testcase classname="VatTest" name="rounds per line"/><testcase classname="VatTest" name="sums lines"/></testsuite></testsuites>', 20);
    write(CODE, 'export const vat = (n: number) => Math.round(n * 20) / 100;\n', 5);

    const plan = await seedPlan(request, { title: PLAN, actions: [{ title: 'Fix VAT rounding' }] });
    const item = plan.actionUids[0];
    const h = { headers: authHeaders() };
    expect((await request.put(`${API}/items/${item}`, { ...h, data: { status: 'in_progress', fileSpecs: [{ path: CODE, action: 'modify' }] } })).ok()).toBeTruthy();
    expect((await request.post(`${API}/items/${item}/artefacts`, { ...h, data: { path: REPORT, role: 'evidence' } })).ok()).toBeTruthy();
    expect((await request.post(`${API}/items/${item}/criteria`, { ...h, data: { text: 'VAT tests pass', kind: 'test', policy: 'agent' } })).ok()).toBeTruthy();

    const agent = await createMcpClient();
    try {
      const r = await agent.callTool('update_item', { uid: item, status: 'done' });
      expect(r.isError).toBe(true);
      expect(r.content[0].text).toMatch(/^Not done: "VAT tests pass" — ⚠ tests older than the code: test-results\/b84a\/vat\.xml ran /);
    } finally {
      agent.close();
    }

    await gotoWithProject(page);
    await openPlan(page, PLAN);
    await page.getByTestId('plan-item-tree').getByText('Fix VAT rounding').first().click();
    const line = page.getByTestId('criteria-block').getByTestId('grounding-line');
    await expect(line).toHaveAttribute('aria-label', '1 criterion · 1 with tests older than the code', { timeout: 10_000 });
    const part = line.getByTestId('grounding-tests_older');
    await expect(part).toHaveText('·⚠1 with tests older than the code');
    await expect(part).toHaveAttribute('title', /^VAT tests pass: ⚠ tests older than the code: test-results\/b84a\/vat\.xml ran .+ before the last change to this item's files .+ — run the tests again$/);
    // And under the criterion itself, in words, without hovering.
    const row = page.getByTestId('criterion-row').filter({ hasText: 'VAT tests pass' });
    await expect(row.getByTestId('criterion-tests-older')).toHaveText(/^⚠ tests older than the code: test-results\/b84a\/vat\.xml ran .+ — run the tests again$/);
    fs.mkdirSync(OUT, { recursive: true });
    const block = page.getByTestId('criteria-block');
    await block.scrollIntoViewIfNeeded();
    await block.screenshot({ path: path.join(OUT, 'stale-done-line.png') });
    // Still under way: the refusal changed nothing.
    expect(((await (await request.get(`${API}/items/${item}`, h)).json()) as { status: string }).status).toBe('in_progress');
  });
});
