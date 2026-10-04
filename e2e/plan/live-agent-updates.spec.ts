/**
 * An open plan follows an agent's work without a reload.
 *
 * An agent claiming a task or reporting progress left the open plan showing
 * it pending, unassigned and with no bar until it was reloaded, and Activity
 * never moved: the window took claims and progress to "cascade through
 * plan-item-updated", and nothing sent one. The harness test
 * (tests/e2e/plan-live-events.test.ts) proves what is broadcast; this proves
 * the window shows it.
 */

import { test, expect } from '@playwright/test';
import { gotoWithProject, seedPlan, openPlan, cleanupPlans, PROJECT_PATH } from '../helpers/setup';
import { createMcpClient } from '../helpers/mcp-client';

type Client = Awaited<ReturnType<typeof createMcpClient>>;

test.describe('An open plan follows the agent working it', () => {
  let client: Client;
  // Unique per run, and the cleanup takes only this run's plan.
  let TITLE = '';

  test.beforeEach(async () => { client = await createMcpClient(); });
  test.afterEach(async ({ request }) => {
    client?.close();
    if (TITLE) await cleanupPlans(request, TITLE);
  });

  test('a claim, a progress report and their Activity appear as they happen', async ({ page, request }) => {
    TITLE = `E2E Live agent ${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
    const seeded = await seedPlan(request, { title: TITLE, actions: [{ title: 'Pair the ledger entries' }] });
    const [uid] = seeded.actionUids;
    await gotoWithProject(page);
    await openPlan(page, TITLE);
    await page.getByTestId('plan-item-tree').getByText('Pair the ledger entries').click();
    const status = page.locator('select[title="Change status"]');
    await expect(status).toHaveValue('pending', { timeout: 10_000 });

    const activity = page.getByRole('button', { name: 'Activity', exact: true });
    if ((await activity.getAttribute('aria-pressed')) !== 'true') await activity.click();

    await client.callTool('register_session', { agent_type: 'codex', agent_model: 'test/1.0', project_path: PROJECT_PATH });
    const claim = await client.callTool('claim_item', { uid, agent_type: 'codex' });
    expect(claim?.isError, JSON.stringify(claim)).not.toBe(true);
    // Status and assignee, as the claim decided them, with no reload.
    await expect(status).toHaveValue('assigned', { timeout: 10_000 });
    await expect(page.getByText('👤 codex')).toBeVisible();
    // And the status change is in Activity.
    await expect(page.getByText('"Pair the ledger entries" pending → assigned')).toBeVisible();

    const progress = await client.callTool('update_item_progress', { uid, percent: 40, message: 'Pairs matched for EUR' });
    expect(progress?.isError, JSON.stringify(progress)).not.toBe(true);
    // The task's own figure, in the tree row: not the progress note's "(40%)".
    await expect(page.getByTestId('plan-item-tree').getByText('40%', { exact: true })).toBeVisible({ timeout: 10_000 });
  });
});
