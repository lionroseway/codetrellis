/**
 * Unverified, and turning it off (Phase 32 carried item 2b): the journey.
 *
 * The owner's decision: a change that came over plain HTTP is kept and shown,
 * with a tag saying so and a tooltip explaining how it arrived, so it can be
 * audited; and a setting in the app closes the door. The browser build is
 * itself plain HTTP, so everything seeded here is unverified, as a script's
 * would be.
 *
 * What the backend stores and refuses is proven by
 * tests/e2e/local-api-changes.test.ts. This walks what the person meets: the
 * tag on a comment, its explanation, the same tag on a budget change waiting
 * to be seen, and the switch in Settings.
 */

import fs from 'node:fs';
import path from 'node:path';
import { test, expect, type Page } from '@playwright/test';
import { gotoWithProject, seedPlan, openPlan, cleanupPlans, API, authHeaders } from '../helpers/setup';

const OUT = path.join('test-results', 'ux-audit');
const TITLE = 'E2E Unverified Plan';

async function shot(page: Page, name: string) {
  fs.mkdirSync(OUT, { recursive: true });
  await page.waitForTimeout(300);
  await page.screenshot({ path: path.join(OUT, `${name}.png`) });
}

test.describe('Unverified changes', () => {
  test.afterEach(async ({ request }) => {
    // Always leave the door open for the specs that follow: /api/settings
    // stays writable in the test build even with it shut.
    await request.put(`${API}/settings`, { headers: authHeaders(), data: { mcp: { acceptLocalApiChanges: true } } });
    await cleanupPlans(request, 'E2E Unverified');
  });

  test('a comment over the local API is tagged, and the tag says how it arrived', async ({ page, request }) => {
    const plan = await seedPlan(request, { title: TITLE, actions: [{ title: 'Audited action', body: 'Body' }] });
    const res = await request.post(`${API}/items/${plan.actionUids[0]}/comments`, {
      headers: authHeaders(), data: { body: 'Posted by a script', kind: 'note' },
    });
    expect(((await res.json()) as { authorType: string }).authorType).toBe('unverified');

    await gotoWithProject(page);
    await openPlan(page, TITLE);
    await page.getByTestId('plan-item-tree').getByText('Audited action').first().click();
    await expect(page.getByText('Posted by a script').first()).toBeVisible({ timeout: 10_000 });

    const tag = page.getByTestId('unverified-tag').first();
    await expect(tag).toBeVisible();
    await expect(tag).toHaveText('unverified');
    await expect(page.getByTestId('unverified-tooltip')).toHaveCount(0);
    await shot(page, 'carried-2b-01-comment-tagged');

    await tag.hover();
    const tip = page.getByTestId('unverified-tooltip');
    await expect(tip).toBeVisible();
    await expect(tip).toContainText('Made over the local API');
    await expect(tip).toContainText('not from the CodeTrellis window');
    await expect(tip).toContainText('Settings → MCP Server → Local API');
    await shot(page, 'carried-2b-02-tooltip');

    // Keyboard too: the tag takes focus and the explanation comes with it.
    await page.mouse.move(0, 0);
    await expect(tip).toHaveCount(0);
    await tag.focus();
    await expect(page.getByTestId('unverified-tooltip')).toBeVisible();
  });

  test('a budget change over the local API waits to be seen, tagged rather than called an agent', async ({ page, request }) => {
    const plan = await seedPlan(request, { title: TITLE, actions: [{ title: 'Budgeted action' }] });
    await request.put(`${API}/plans/${plan.uid}/budget`, { headers: authHeaders(), data: { minutes: 90 } });

    await gotoWithProject(page);
    await openPlan(page, TITLE);
    // The chip sits on the plan's own page, beside its git context.
    const chip = page.getByTestId('plan-budget-chip');
    await expect(chip.getByLabel(/1 budget change to review/)).toBeVisible({ timeout: 10_000 });
    await chip.click();
    const change = page.getByTestId('budget-flagged-change');
    await expect(change.getByTestId('unverified-tag')).toBeVisible();
    await expect(change).not.toContainText('(agent)');
    await shot(page, 'carried-2b-03-budget-flagged');
    await change.getByRole('button', { name: 'Seen' }).click();
    await expect(page.getByTestId('budget-flagged-changes')).toHaveCount(0);
  });

  test('turned off in Settings, a change over the local API is refused with where to turn it back on', async ({ page, request }) => {
    await gotoWithProject(page);
    await page.locator('button[title*="Settings"]').click();
    await page.getByRole('dialog').getByRole('button', { name: 'MCP Server', exact: true }).click();
    const box = page.locator('#settings-local-api-changes');
    await expect(box).toBeChecked();
    await page.getByTestId('local-api-changes').scrollIntoViewIfNeeded();
    await shot(page, 'carried-2b-04-setting-on');

    // The box follows the saved setting, so it turns over when the save lands.
    await box.click();
    await expect(box).not.toBeChecked();
    await expect.poll(async () =>
      ((await (await request.get(`${API}/settings`, { headers: authHeaders() })).json()) as { mcp: { acceptLocalApiChanges?: boolean } }).mcp.acceptLocalApiChanges,
    ).toBe(false);
    await shot(page, 'carried-2b-05-setting-off');

    const refused = await request.post(`${API}/plans`, { headers: authHeaders(), data: { title: 'E2E Unverified refused' } });
    expect(refused.status()).toBe(403);
    expect(((await refused.json()) as { error: string }).error).toContain('Settings → MCP Server → Local API');
    // Reading is untouched.
    expect((await request.get(`${API}/plans`, { headers: authHeaders() })).ok()).toBe(true);

    await box.click();
    await expect(box).toBeChecked();
    await expect.poll(async () =>
      ((await (await request.get(`${API}/settings`, { headers: authHeaders() })).json()) as { mcp: { acceptLocalApiChanges?: boolean } }).mcp.acceptLocalApiChanges,
    ).not.toBe(false);
  });
});
