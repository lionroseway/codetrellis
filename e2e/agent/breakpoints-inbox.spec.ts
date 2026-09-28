/**
 * Breakpoints from the window (Phase 32 B4.3a): a person sets one on a task,
 * an agent is held there, and the person answers from the top of the inbox.
 *
 * 1. In the task's Routing panel, "Ask me first: before an agent claims or
 *    finishes this" is ticked.
 * 2. A real agent claims the task over MCP and is paused.
 * 3. The Awareness badge counts it; "Waiting on you" says who wanted to do
 *    what and why it waits.
 * 4. A steer is written and sent: the card goes, and the agent's next claim
 *    carries the note.
 * 5. The breakpoint is listed under Breakpoints and cleared there; a rule on
 *    contract signals is ticked and unticked.
 *
 * A breach is shown from a given list, since making one needs a worktree:
 * it is worded as what happened, never as a pause.
 */

import fs from 'node:fs';
import path from 'node:path';
import { test, expect, type Page } from '@playwright/test';
import { gotoWithProject, openPlan, seedPlan, cleanupPlans, API, authHeaders } from '../helpers/setup';
import { createMcpClient } from '../helpers/mcp-client';
import type { Breakpoint, BreakpointHit } from '../../src/shared/types';

const OUT = path.join('test-results', 'ux-audit');
const PLAN = 'E2E B4.3 breakpoints inbox plan';

async function openAwareness(page: Page, fromWorkspace = false) {
  // In a plan workspace the bottom panel is behind it: Escape minimises the workspace.
  if (fromWorkspace) {
    await page.keyboard.press('Escape');
    await expect(page.locator('button[title*="Restore plan workspace"]')).toBeVisible({ timeout: 5_000 });
  }
  await page.getByRole('button', { name: /^Awareness( \d+)?$/ }).click();
}

test.describe('Breakpoints from the window', () => {
  test.setTimeout(120_000);
  test.afterEach(async ({ request }) => {
    const { breakpoints } = (await (await request.get(`${API}/breakpoints`, { headers: authHeaders() })).json()) as { breakpoints: Breakpoint[] };
    for (const b of breakpoints) {
      if (b.targetTitle?.startsWith('B4.3 ') || (b.kind === 'signal' && b.note === null)) await request.delete(`${API}/breakpoints/${b.id}`, { headers: authHeaders() });
    }
    await cleanupPlans(request, PLAN);
  });

  test('set on a task, an agent held, answered with a steer from the inbox, then cleared', async ({ page, request }) => {
    const title = `B4.3 Partial refunds ${Date.now()}`;
    const plan = await seedPlan(request, { title: PLAN, actions: [{ title }] });
    const task = plan.actionUids[0];

    await gotoWithProject(page);
    await openPlan(page, PLAN);
    await page.getByText(title).first().click();
    const ask = page.getByTestId('ask-me-first');
    await expect(async () => {
      if (!(await ask.isVisible())) await page.getByRole('button', { name: /Routing & Execution/i }).click();
      await expect(ask).toBeVisible({ timeout: 1_000 });
    }).toPass({ timeout: 15_000 });
    // The box shows what the server holds, so it ticks once the breakpoint is set.
    await ask.getByTestId('ask-me-task').click();
    await expect(ask.getByTestId('ask-me-task')).toBeChecked();
    fs.mkdirSync(OUT, { recursive: true });
    await ask.screenshot({ path: path.join(OUT, 'breakpoints-ask-me-first.png') });
    const set = (await (await request.get(`${API}/breakpoints`, { headers: authHeaders() })).json()) as { breakpoints: Breakpoint[] };
    expect(set.breakpoints.find((b) => b.kind === 'task' && b.target === task)).toBeTruthy();

    // A real agent claims it, and is held.
    const agent = await createMcpClient();
    try {
      const paused = JSON.parse((await agent.callTool('claim_item', { uid: task })).content[0].text);
      expect(paused).toMatchObject({ paused: true });

      await openAwareness(page, true);
      const card = page.getByTestId('breakpoint-waiting').filter({ hasText: title });
      await expect(card).toBeVisible({ timeout: 10_000 });
      await expect(card).toContainText(`wants to claim “${title}”`);
      await expect(card).toContainText('You asked to be asked before an agent claims or finishes this task.');
      await expect(card).toContainText('Paused');
      await expect(page.getByRole('button', { name: /^Awareness \d+$/ })).toBeVisible();
      // Continue with steer needs the note first.
      await expect(card.getByRole('button', { name: 'Continue with steer' })).toBeDisabled();
      await card.getByLabel('A note the agent will read').fill("Go ahead, but don't change the refund path");
      await card.screenshot({ path: path.join(OUT, 'breakpoints-waiting.png') });
      await card.getByRole('button', { name: 'Continue with steer' }).click();
      await expect(card).toHaveCount(0);

      const claimed = (await agent.callTool('claim_item', { uid: task })).content.map((c: { text: string }) => c.text).join('\n');
      expect(claimed).toContain("continue, with this steer: Go ahead, but don't change the refund path");
    } finally {
      agent.close();
    }

    // What is set, and clearing it; a rule on a kind of signal.
    const section = page.getByTestId('breakpoints-set');
    await section.getByRole('button', { name: /Breakpoints/ }).click();
    const row = section.getByTestId('breakpoint-set').filter({ hasText: title });
    await expect(row).toContainText('before an agent claims or finishes it');
    const rules = section.getByTestId('breakpoint-signal-rules');
    await rules.getByLabel('contract').click();
    await expect(rules.getByLabel('contract')).toBeChecked();
    await section.screenshot({ path: path.join(OUT, 'breakpoints-set.png') });
    await row.getByRole('button', { name: /Clear the breakpoint/ }).click();
    await expect(row).toHaveCount(0);
    await rules.getByLabel('contract').click();
    await expect(rules.getByLabel('contract')).not.toBeChecked();
    const after = (await (await request.get(`${API}/breakpoints`, { headers: authHeaders() })).json()) as { breakpoints: Breakpoint[] };
    expect(after.breakpoints.some((b) => b.target === task || (b.kind === 'signal' && b.target === 'contract'))).toBe(false);
  });

  test('a breach reads as what happened, and is answered carry on or stop', async ({ page }) => {
    const now = Date.now();
    const hits: BreakpointHit[] = [{
      ref: 'bp-breach', breakpointId: 'bp_x', kind: 'code', breakpointNote: 'Ask me before touching shared', tool: 'edit', action: 'breach',
      itemUid: '', itemTitle: null, path: 'packages/shared/src/validators.ts', breach: true, signalId: null, planUid: null,
      agent: 'codex', sessionId: 's', workstreamRoot: '/work/acme-exports', hitAt: now - 4 * 60_000, decision: null, note: null,
      answeredAt: null, answeredBy: null, answeredByType: null,
    }];
    await page.route('**/api/breakpoint-hits', (route) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ hits }) }));
    await gotoWithProject(page);
    await openAwareness(page);
    const card = page.getByTestId('breakpoint-waiting').filter({ hasText: 'past a breakpoint' });
    await expect(card).toBeVisible({ timeout: 10_000 });
    await expect(card).toHaveAttribute('data-breach', 'true');
    await expect(card).toContainText('Breach');
    await expect(card).toContainText('codex in acme-exports changed packages/shared/src/validators.ts past a breakpoint');
    await expect(card).toContainText('It could not be paused');
    await expect(card).toContainText('Your note on the breakpoint: “Ask me before touching shared”');
    await expect(card).not.toContainText('Paused');
    await expect(card.getByRole('button', { name: 'Carry on', exact: true })).toBeVisible();
    await expect(card.getByRole('button', { name: 'Stop' })).toBeVisible();
    fs.mkdirSync(OUT, { recursive: true });
    await card.screenshot({ path: path.join(OUT, 'breakpoints-breach.png') });
  });
});
