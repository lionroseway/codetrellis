/**
 * Phase 32 B6.4b — one selection: following a plan in the Stack tab narrows
 * the Timeline to its work.
 *
 * Two agents, one working on each plan: one leaves a note on Billing's task,
 * the other on Exports'. Following Billing leaves only the first agent's turn
 * in the Timeline, with a bar that says whose work is shown and lets it go.
 * Other workers' agents may be adding turns of their own meanwhile; they are
 * neither plan's, so they go too.
 */
import fs from 'node:fs';
import path from 'node:path';
import { test, expect, type Page } from '@playwright/test';
import { cleanupPlans, gotoWithProject, seedPlan } from '../helpers/setup';
import { createMcpClient } from '../helpers/mcp-client';

const OUT = path.join('test-results', 'ux-audit');
const BILLING = 'E2E Follow Billing';
const EXPORTS = 'E2E Follow Exports';

async function shot(page: Page, name: string) {
  fs.mkdirSync(OUT, { recursive: true });
  await page.waitForTimeout(300);
  await page.screenshot({ path: path.join(OUT, `${name}.png`) });
}

test.describe('Following a plan from the stack', () => {
  const agents: Array<Awaited<ReturnType<typeof createMcpClient>>> = [];
  test.afterEach(async ({ request }) => {
    for (const a of agents.splice(0)) a.close();
    await cleanupPlans(request, 'E2E Follow');
  });

  test('narrows the Timeline to that plan\'s work, says so, and lets it go', async ({ page, request }) => {
    const billing = await seedPlan(request, { title: BILLING, actions: [{ title: 'Migrate schema' }] });
    const exportsPlan = await seedPlan(request, { title: EXPORTS, actions: [{ title: 'Deploy exports' }] });
    const [migrate] = billing.actionUids;
    const [deploy] = exportsPlan.actionUids;

    await gotoWithProject(page);

    const onBilling = await createMcpClient();
    const onExports = await createMcpClient();
    agents.push(onBilling, onExports);
    await onBilling.callTool('add_item_comment', { uid: migrate, kind: 'note', body: 'Billing: schema drafted' });
    await onExports.callTool('add_item_comment', { uid: deploy, kind: 'note', body: 'Exports: pipeline ready' });

    // A turn's summary names the task by its uid, shortened ("Commented on ac3f6de8-7cd…").
    const billingTurn = page.getByTestId('turn-card').filter({ hasText: migrate.slice(0, 8) });
    const exportsTurn = page.getByTestId('turn-card').filter({ hasText: deploy.slice(0, 8) });
    await page.getByRole('button', { name: /^Timeline/ }).first().click();
    await expect(billingTurn).toHaveCount(1, { timeout: 15_000 });
    await expect(exportsTurn).toHaveCount(1);
    await expect(page.getByTestId('timeline-following')).toHaveCount(0);

    // Follow Billing from the stack.
    await page.getByRole('button', { name: 'Stack', exact: true }).first().click();
    const billingRow = page.locator(`[data-testid="stack-plan"][data-plan-uid="${billing.uid}"]`);
    await expect(billingRow).toBeVisible({ timeout: 10_000 });
    await billingRow.getByTestId('stack-show-on-graph').click();
    await expect(billingRow.getByTestId('stack-show-on-graph')).toHaveText(/Following/);

    // The Timeline shows Billing's work only, and says so.
    await page.getByRole('button', { name: /^Timeline/ }).first().click();
    const bar = page.getByTestId('timeline-following');
    await expect(bar).toContainText(`Showing ${BILLING}’s work:`);
    await expect(billingTurn).toHaveCount(1);
    await expect(exportsTurn).toHaveCount(0);
    await shot(page, 'stack-follow-timeline');

    // Show all lets the selection go, everywhere at once.
    await page.getByTestId('timeline-show-all').click();
    await expect(bar).toHaveCount(0);
    await expect(exportsTurn).toHaveCount(1);
    await page.getByRole('button', { name: 'Stack', exact: true }).first().click();
    await expect(billingRow.getByTestId('stack-show-on-graph')).toHaveText(/^\s*Follow\s*$/);
  });
});
