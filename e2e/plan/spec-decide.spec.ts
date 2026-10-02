/**
 * Phase 32 B7.4 — a person decides a proposed spec change from the inbox
 * (JOURNEYS I1).
 *
 * An agent working "Add currency" proposes a new Fields section for
 * "Invoice format"; the agent on "Show invoice totals" (relies on Fields) says it
 * changes its work. Awareness counts it, and "Waiting on you" shows
 * "✎ … proposes a change to § Fields", why, now and proposed, and the reply.
 * The person amends the text and accepts it. The page has the amended text;
 * "Show invoice totals" says "Spec changed", and once its agent's next call has
 * told it, says so there and then.
 */
import fs from 'node:fs';
import path from 'node:path';
import { test, expect, type Page } from '@playwright/test';
import { API, authHeaders, cleanupPlans, gotoWithProject, openPlan, seedPlan } from '../helpers/setup';
import { createMcpClient } from '../helpers/mcp-client';

const OUT = path.join('test-results', 'ux-audit');
const SPEC = 'E2E Spec decide Invoicing';
const CHECKOUT = 'E2E Spec decide Checkout';
const BILLING = 'E2E Spec decide Billing';
// A title no other spec uses: plans opened on the other worker are broadcast
// to this page too, and spec-held-edit seeds its own "Show totals".
const BODY = '# Invoice format\n\nAn invoice is JSON.\n\n## Fields\n\n- amount\n\n## Totals\n\nSum of lines.\n';

async function shot(target: Page | ReturnType<Page['getByTestId']>, name: string) {
  fs.mkdirSync(OUT, { recursive: true });
  await new Promise((r) => setTimeout(r, 300));
  await target.screenshot({ path: path.join(OUT, `${name}.png`) });
}

const text = (r: { content: Array<{ text: string }> }) => r.content.map((c) => c.text).join('\n');

test.describe('Deciding a spec change', () => {
  test.setTimeout(120_000);
  test.afterEach(async ({ request }) => { await cleanupPlans(request, 'E2E Spec decide'); });

  test('the proposal waits in the inbox; amended and accepted, the relying task says the spec changed', async ({ page, request }) => {
    const spec = await seedPlan(request, { title: SPEC });
    const made = await request.post(`${API}/plans/${spec.uid}/items`, { headers: authHeaders(), data: { kind: 'object', title: 'Invoice format', body: BODY } });
    const pageUid = ((await made.json()) as { uid: string }).uid;
    const checkout = await seedPlan(request, { title: CHECKOUT, actions: [{ title: 'Show invoice totals' }] });
    const billing = await seedPlan(request, { title: BILLING, actions: [{ title: 'Add currency' }] });
    const showTotals = checkout.actionUids[0];
    expect((await request.put(`${API}/items/${showTotals}/relies-on`, { headers: authHeaders(), data: { reliesOn: [{ page: pageUid, section: 'fields' }] } })).ok()).toBeTruthy();

    const proposer = await createMcpClient();
    const checkoutAgent = await createMcpClient();
    try {
      await proposer.callTool('claim_item', { uid: billing.actionUids[0] });
      await checkoutAgent.callTool('claim_item', { uid: showTotals });
      const proposed = JSON.parse((await proposer.callTool('propose_spec_change', {
        page_uid: pageUid, section: 'fields', text: '## Fields\n\n- amount\n- currency',
        why: 'Amounts are ambiguous for EU customers.', evidence: { tests: ['invoice_eu.spec'] },
      })).content[0].text) as { proposal: { uid: string } };
      const told = text(await checkoutAgent.callTool('get_spec_links', { uid: showTotals }));
      expect(told).toContain('── CodeTrellis: spec change proposed ──');
      await checkoutAgent.callTool('reply_to_spec_proposal', {
        uid: proposed.proposal.uid, impact: 'changes', words: 'The totals row must show the currency.', tasks: 1,
      });

      // The inbox: counted, and the card says what would change and who said what.
      await gotoWithProject(page);
      await expect(page.getByRole('button', { name: /^Awareness \d+$/ })).toBeVisible({ timeout: 15_000 });
      const tab = page.getByRole('button', { name: /^Awareness( \d+)?$/ });
      await tab.click();
      await tab.locator('..').getByRole('button', { name: 'Expand panel' }).click();
      const card = page.getByTestId('proposal-waiting').filter({ hasText: 'Invoice format' });
      await expect(card).toBeVisible({ timeout: 10_000 });
      await expect(card.getByTestId('proposal-headline')).toContainText('proposes a change to § Fields of “Invoice format”');
      await expect(card).toContainText('Why: Amounts are ambiguous for EU customers.');
      await expect(card).toContainText('Evidence: tests invoice_eu.spec');
      await expect(card.getByTestId('proposal-diff')).toContainText('- currency');
      await expect(card.getByTestId('proposal-impacts')).toContainText('1 task in 1 plan relies on this. 1 of 1 replied.');
      await expect(card.getByTestId('proposal-impact')).toContainText('Changes 1 task');
      await expect(card.getByTestId('proposal-impact')).toContainText('Show invoice totals (E2E Spec decide Checkout)');
      await shot(card, 'spec-decision-card');

      // Amend, then accept.
      await card.getByRole('button', { name: 'Amend', exact: true }).click();
      const box = card.getByLabel('The text as it should read');
      await expect(box).toHaveValue('## Fields\n\n- amount\n- currency');
      await box.fill('## Fields\n\n- amount\n- currency (ISO 4217, required)');
      await card.getByLabel('A note for the proposer').fill('Name the standard.');
      await shot(card, 'spec-decision-amend');
      await card.getByRole('button', { name: 'Accept amended' }).click();
      await expect(card).toHaveCount(0, { timeout: 10_000 });
      await tab.locator('..').getByRole('button', { name: 'Collapse panel' }).click();

      const pageNow = (await (await request.get(`${API}/items/${pageUid}`, { headers: authHeaders() })).json()) as { body: string };
      expect(pageNow.body).toContain('- currency (ISO 4217, required)');

      // The relying task says the spec changed, until and after its agent is told.
      await openPlan(page, CHECKOUT);
      await page.getByTestId('plan-item-tree').getByText('Show invoice totals', { exact: true }).first().click();
      const changed = page.getByTestId('spec-changed');
      await expect(changed).toBeVisible({ timeout: 10_000 });
      await expect(changed).toContainText('Spec changed');
      await expect(changed).toContainText('§ Fields of Invoice format');
      await expect(changed).toContainText('its agent is told on its next step');
      await shot(page, 'spec-changed');

      const later = text(await checkoutAgent.callTool('get_spec_links', { uid: showTotals }));
      expect(later).toContain('── CodeTrellis: spec changed ──');
      expect(later).toContain('Their note: Name the standard.');
      // Said on the open task as it happens, without opening it again.
      await expect(changed).toContainText('its agent has been told', { timeout: 10_000 });
    } finally {
      proposer.close();
      checkoutAgent.close();
    }
  });
});
