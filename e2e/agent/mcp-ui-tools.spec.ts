/**
 * The UI tools, driven over MCP against a real page (Phase 32 §0.4g).
 *
 * They only broadcast; the window does the work. The harness test
 * (tests/e2e/agent-ui-tools.test.ts) proves each sends the right event.
 * This proves the window follows it: the plan opens, the item is selected,
 * the drawers and dialogs open, the panel toggles.
 *
 * Serial (playwright.config SERIAL_SPECS): the tools reach every open page.
 */

import { test, expect } from '@playwright/test';
import { gotoWithProject, seedPlan, cleanupPlans, API, authHeaders, PROJECT_PATH } from '../helpers/setup';
import { createMcpClient } from '../helpers/mcp-client';

type Client = Awaited<ReturnType<typeof createMcpClient>>;

test.describe('UI tools against the window', () => {
  const TITLE = `E2E UI tools ${Date.now()}`;
  let client: Client;

  test.beforeEach(async () => { client = await createMcpClient(); });
  test.afterEach(async ({ request }) => {
    client?.close();
    await cleanupPlans(request, 'E2E UI tools');
  });

  test('open_plan, select_item, the drawers, settings and the guide follow the agent', async ({ page, request }) => {
    const seeded = await seedPlan(request, { title: TITLE, actions: [{ title: 'Wire the loader' }, { title: 'Check the totals' }] });
    const [first, second] = seeded.actionUids;
    await gotoWithProject(page);

    await client.callTool('open_plan', { plan_uid: seeded.uid });
    await expect(page.getByTestId('plan-item-tree').getByText('Wire the loader')).toBeVisible({ timeout: 15_000 });

    await client.callTool('select_item', { item_uid: second });
    const selected = page.getByTestId('plan-item-tree').locator('[aria-current="true"]');
    await expect(selected).toHaveText(/Check the totals/, { timeout: 10_000 });
    await client.callTool('select_item', { item_uid: first });
    await expect(selected).toHaveText(/Wire the loader/);
    // Back and forward through what was selected.
    await client.callTool('navigate_item_back', {});
    await expect(selected).toHaveText(/Check the totals/);
    await client.callTool('navigate_item_forward', {});
    await expect(selected).toHaveText(/Wire the loader/);

    const activity = page.getByRole('button', { name: 'Activity', exact: true });
    const before = await activity.getAttribute('aria-pressed');
    await client.callTool('toggle_activity_drawer', {});
    await expect(activity).toHaveAttribute('aria-pressed', before === 'true' ? 'false' : 'true');
    await client.callTool('toggle_activity_drawer', {});
    await expect(activity).toHaveAttribute('aria-pressed', before ?? 'false');

    await client.callTool('open_history_drawer', { item_uid: first });
    await expect(page.getByRole('heading', { name: /History · Wire the loader/ })).toBeVisible();
    await page.getByRole('heading', { name: /History · Wire the loader/ }).locator('xpath=following-sibling::button').click();
    await expect(page.getByRole('heading', { name: /History · / })).toHaveCount(0);

    await client.callTool('open_settings', {});
    const settings = page.getByRole('dialog', { name: 'Settings' });
    await expect(settings).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(settings).toHaveCount(0);

    await client.callTool('open_mcp_guide', {});
    await expect(page.getByRole('dialog', { name: 'CodeTrellis guide' })).toBeVisible();
  });

  test('navigate_to opens each tab of the side panel, and ui_ready says which is showing', async ({ page }) => {
    // The demo's Phase 32 scenes need to put Awareness, the Stack and Review
    // in front of a person, and to check a picture of one is
    // a picture of that one.
    await gotoWithProject(page);
    for (const [target, testId] of [['awareness', 'awareness-tab'], ['stack', 'stack-tab'], ['review', 'review-tab']] as const) {
      const res = await client.callTool('navigate_to', { target });
      expect(res.isError, res.content?.[0]?.text).toBeFalsy();
      await expect(page.getByTestId(testId)).toBeVisible({ timeout: 10_000 });
      const ready = JSON.parse((await client.callTool('ui_ready', {})).content[0].text);
      expect(ready.planPanelTab).toBe(target);
    }
  });

  test('a wrong uid changes nothing on screen, and the agent is told', async ({ page, request }) => {
    const seeded = await seedPlan(request, { title: TITLE, actions: [{ title: 'Stay on this' }] });
    await gotoWithProject(page);
    await client.callTool('open_plan', { plan_uid: seeded.uid });
    await expect(page.getByTestId('plan-item-tree').getByText('Stay on this')).toBeVisible({ timeout: 15_000 });

    const res = await client.callTool('open_plan', { plan_uid: 'no-such-plan' });
    expect(res.isError).toBe(true);
    expect(res.content[0].text).toBe('Plan no-such-plan not found.');
    // No "Could not load plan" toast, and the plan stays open.
    await page.waitForTimeout(500);
    await expect(page.getByText('Could not load plan')).toHaveCount(0);
    await expect(page.getByTestId('plan-item-tree').getByText('Stay on this')).toBeVisible();
  });

  test('an agent\'s budget change shows as a flag on the chip until the person marks it seen (0.4g)', async ({ page, request }) => {
    const seeded = await seedPlan(request, { title: TITLE, actions: [{ title: 'Budgeted work' }] });
    await gotoWithProject(page);
    await client.callTool('open_plan', { plan_uid: seeded.uid });
    await expect(page.getByTestId('plan-item-tree').getByText('Budgeted work')).toBeVisible({ timeout: 15_000 });

    // A ceiling set over plain HTTP, then the agent raises it — while the plan
    // is open. Both are flagged: the first tagged unverified (carried 2b).
    const res = await request.put(`${API}/plans/${seeded.uid}/budget`, { headers: authHeaders(), data: { minutes: 120 } });
    expect(res.ok()).toBe(true);
    await client.callTool('set_budget', { plan_uid: seeded.uid, minutes: 240 });

    const chip = page.getByTestId('plan-budget-chip');
    await expect(chip.getByLabel(/2 budget changes to review/)).toBeVisible({ timeout: 10_000 });
    await chip.click();
    const changes = page.getByTestId('budget-flagged-change');
    await expect(changes).toHaveCount(2);
    await expect(changes.nth(0).getByTestId('unverified-tag')).toBeVisible();
    await expect(changes.nth(0)).not.toContainText('(agent)');
    await expect(changes.nth(1)).toContainText('(agent) raised the time ceiling 2h → 4h');
    await changes.nth(1).getByRole('button', { name: 'Seen' }).click();
    await changes.nth(0).getByRole('button', { name: 'Seen' }).click();
    await expect(page.getByTestId('budget-flagged-changes')).toHaveCount(0);
    await expect(chip.getByLabel(/budget change/)).toHaveCount(0);
  });

  test('an agent\'s freeze changes show on the freeze bar until the person marks them seen, lifting included (0.4k)', async ({ page, request }) => {
    const seeded = await seedPlan(request, { title: TITLE, actions: [{ title: 'Frozen work' }] });
    await gotoWithProject(page);
    await client.callTool('open_plan', { plan_uid: seeded.uid });
    await expect(page.getByTestId('plan-item-tree').getByText('Frozen work')).toBeVisible({ timeout: 15_000 });
    try {
      // The agent freezes, then lifts it — the lift is the change that used
      // to make the bar vanish.
      await client.callTool('set_freeze', { project_path: PROJECT_PATH, active: true, reason: 'Release week' });
      await expect(page.getByTestId('freeze-bar')).toContainText('Project frozen', { timeout: 10_000 });
      await client.callTool('set_freeze', { project_path: PROJECT_PATH, active: false });

      const flags = page.getByTestId('freeze-flagged-change');
      await expect(flags).toHaveCount(2, { timeout: 10_000 });
      await expect(flags.nth(0)).toContainText('(agent) froze the project ("Release week") with no end');
      await expect(flags.nth(1)).toContainText('(agent) lifted the freeze');
      await expect(page.getByTestId('freeze-bar')).not.toContainText('Project frozen');

      await flags.nth(0).getByRole('button', { name: 'Seen' }).click();
      await expect(flags).toHaveCount(1);
      await flags.nth(0).getByRole('button', { name: 'Seen' }).click();
      await expect(page.getByTestId('freeze-bar')).toHaveCount(0);
    } finally {
      // Leave the shared project unfrozen and nothing flagged for the next spec.
      await request.put(`${API}/freeze`, { headers: authHeaders(), data: { projectPath: PROJECT_PATH, active: false } });
      const st = await (await request.get(`${API}/freeze?project=${encodeURIComponent(PROJECT_PATH)}`, { headers: authHeaders() })).json();
      for (const c of st.flaggedChanges ?? []) {
        await request.post(`${API}/freeze/changes/${c.id}/acknowledge`, { headers: authHeaders(), data: { projectPath: PROJECT_PATH } });
      }
    }
  });
});

