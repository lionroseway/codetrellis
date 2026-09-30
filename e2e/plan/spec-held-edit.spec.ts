/**
 * Phase 32 B7.5a — a guarded page others rely on, in the inbox (JOURNEYS I1).
 *
 * The person guards "Invoice format" with a spec breakpoint and a note. An
 * agent tries to edit it directly and is held; "Waiting on you" says two
 * tasks in two plans rely on the page and that the agent was told to propose
 * instead. The agent proposes: the proposal's card shows the person's note on
 * the breakpoint.
 */
import fs from 'node:fs';
import path from 'node:path';
import { test, expect, type Page } from '@playwright/test';
import { API, authHeaders, cleanupPlans, gotoWithProject, seedPlan } from '../helpers/setup';
import { createMcpClient } from '../helpers/mcp-client';

const OUT = path.join('test-results', 'ux-audit');
const BODY = '# Invoice format\n\nAn invoice is JSON.\n\n## Fields\n\n- amount\n';
const NOTE = 'Invoices go to the tax office; ask me first.';

async function shot(target: Page | ReturnType<Page['getByTestId']>, name: string) {
  fs.mkdirSync(OUT, { recursive: true });
  await new Promise((r) => setTimeout(r, 300));
  await target.screenshot({ path: path.join(OUT, `${name}.png`) });
}

test.describe('A guarded page others rely on', () => {
  test.setTimeout(120_000);
  test.afterEach(async ({ request }) => { await cleanupPlans(request, 'E2E Held edit'); });

  test('a held direct edit says who relies on the page; the proposal shows the note', async ({ page, request }) => {
    const spec = await seedPlan(request, { title: 'E2E Held edit Invoicing' });
    const made = await request.post(`${API}/plans/${spec.uid}/items`, { headers: authHeaders(), data: { kind: 'object', title: 'Invoice format', body: BODY } });
    const pageUid = ((await made.json()) as { uid: string }).uid;
    const checkout = await seedPlan(request, { title: 'E2E Held edit Checkout', actions: [{ title: 'Show totals' }] });
    const exports = await seedPlan(request, { title: 'E2E Held edit Exports', actions: [{ title: 'Export invoices' }] });
    const billing = await seedPlan(request, { title: 'E2E Held edit Billing', actions: [{ title: 'Add currency' }] });
    for (const uid of [checkout.actionUids[0], exports.actionUids[0]]) {
      expect((await request.put(`${API}/items/${uid}/relies-on`, { headers: authHeaders(), data: { reliesOn: [{ page: pageUid }] } })).ok()).toBeTruthy();
    }
    const bp = await request.post(`${API}/breakpoints`, { headers: authHeaders(), data: { kind: 'spec', itemUid: pageUid, note: NOTE } });
    expect(bp.ok()).toBeTruthy();
    const bpId = ((await bp.json()) as { breakpoint: { id: string } }).breakpoint.id;

    const agent = await createMcpClient();
    try {
      await agent.callTool('claim_item', { uid: billing.actionUids[0] });
      const held = JSON.parse((await agent.callTool('update_item', { uid: pageUid, body: `${BODY}- currency\n` })).content[0].text) as { paused: boolean; message: string };
      expect(held.paused).toBe(true);
      expect(held.message).toContain('2 tasks in 2 plans rely on this page');

      await gotoWithProject(page);
      const tab = page.getByRole('button', { name: /^Awareness( \d+)?$/ });
      await expect(page.getByRole('button', { name: /^Awareness \d+$/ })).toBeVisible({ timeout: 15_000 });
      await tab.click();
      await tab.locator('..').getByRole('button', { name: 'Expand panel' }).click();
      const card = page.getByTestId('breakpoint-waiting').filter({ hasText: 'Invoice format' });
      await expect(card).toBeVisible({ timeout: 10_000 });
      await expect(card.getByTestId('breakpoint-why')).toContainText('2 tasks in 2 plans rely on this page; the agent was told a proposal would let their agents weigh in.');
      await expect(card).toContainText(NOTE);
      await shot(card, 'spec-held-edit');

      await agent.callTool('propose_spec_change', { page_uid: pageUid, section: 'fields', text: '## Fields\n\n- amount\n- currency', why: 'Amounts are ambiguous for EU customers.' });
      const proposal = page.getByTestId('proposal-waiting').filter({ hasText: 'Invoice format' });
      await expect(proposal).toBeVisible({ timeout: 10_000 });
      await expect(proposal.getByTestId('proposal-guard')).toContainText(`You guard this page with a breakpoint: “${NOTE}”`);
      await shot(proposal, 'spec-proposal-guarded');
      await tab.locator('..').getByRole('button', { name: 'Collapse panel' }).click();
    } finally {
      agent.close();
      await request.delete(`${API}/breakpoints/${bpId}`, { headers: authHeaders() });
    }
  });
});
