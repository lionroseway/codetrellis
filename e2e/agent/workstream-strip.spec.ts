/**
 * The workstreams strip in the TopBar (Phase 32 A1.3).
 *
 * What the backend returns is proven by tests/e2e/workstreams.test.ts
 * against real worktrees and sessions. This drives the strip with fixed
 * answers so each state a person can meet is shown and photographed:
 * nothing to show, parallel work, a shared folder, a chip's details, and
 * more workstreams than fit.
 */

import fs from 'node:fs';
import path from 'node:path';
import { test, expect, type Page } from '@playwright/test';
import { gotoWithProject } from '../helpers/setup';
import type { Workstream, WorkstreamAgent } from '../../src/shared/types';

const OUT = path.join('test-results', 'ux-audit');

async function shot(page: Page, name: string) {
  fs.mkdirSync(OUT, { recursive: true });
  await page.waitForTimeout(300);
  await page.screenshot({ path: path.join(OUT, `${name}.png`), clip: { x: 0, y: 0, width: 1440, height: 320 } });
}

const now = Date.now();
const agent = (sessionId: string, agentType: string, extra: Partial<WorkstreamAgent> = {}): WorkstreamAgent => ({
  sessionId, agentType, model: null, source: 'mcp', lastSeen: now - 12_000, ...extra,
});
const ws = (root: string, branch: string | null, main: boolean, agents: WorkstreamAgent[]): Workstream => ({
  root, branch, head: '3f9c2e1a7b', main, shape: agents.length >= 2 ? 'shared' : 'worktree', agents, idle: agents.length === 0,
});

/**
 * Answer the strip, and the agents list beside it with the same connected
 * agents, so a photograph shows one consistent room.
 */
async function serve(page: Page, answer: Workstream[]) {
  await page.route('**/api/workstreams?*', (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(answer) }));
  const sessions = answer.flatMap((w) => w.agents.filter((a) => a.source === 'mcp').map((a) => ({
    sessionId: a.sessionId, agentType: a.agentType, model: a.model, activePlanUid: null,
    connectedAt: now - 600_000, lastSeen: a.lastSeen ?? now, status: 'active', capabilities: [],
    workstreamRoot: w.root, hostTerminalId: null,
  })));
  await page.route('**/api/sessions', (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(sessions) }));
}

const strip = (page: Page) => page.getByTestId('workstream-strip');
const chips = (page: Page) => page.getByTestId('workstream-chip');

test.describe('Workstreams strip', () => {
  test.use({ viewport: { width: 1440, height: 900 } });

  test('one agent in the project itself shows no strip: ConnectedAgents already says it', async ({ page }) => {
    await serve(page, [ws('/work/acme', 'main', true, [agent('s1', 'claude-code')]), ws('/work/acme-old', 'old', false, [])]);
    const answered = page.waitForResponse('**/api/workstreams?*');
    await gotoWithProject(page);
    await answered;
    await expect(strip(page)).toHaveCount(0);
  });

  test('parallel work gets a chip per workstream, with its branch and agents', async ({ page }) => {
    await serve(page, [
      ws('/work/acme', 'main', true, [agent('s1', 'claude-code', { model: 'opus' })]),
      ws('/work/acme-auth', 'auth-refresh', false, [agent('s2', 'codex')]),
      ws('/work/acme-billing', 'billing-v2', false, [agent('s3', 'claude-code'), agent('cc-9', 'claude-code', { source: 'claude-log', lastSeen: null })]),
      ws('/work/acme-idle', 'docs', false, []),
    ]);
    await gotoWithProject(page);
    await expect(chips(page)).toHaveText(['main', 'auth-refresh', 'billing-v2']);
    // The shared folder carries its warning on the chip itself.
    await expect(chips(page).nth(2).getByLabel('shared folder')).toBeVisible();
    await expect(chips(page).nth(1).getByLabel('shared folder')).toHaveCount(0);
    await shot(page, 'workstreams-strip');
  });

  test("a chip opens its folder, its agents and, when shared, what to do about it", async ({ page }) => {
    await serve(page, [
      ws('/work/acme-auth', 'auth-refresh', false, [agent('s2', 'codex', { model: 'gpt-5' })]),
      ws('/work/acme-billing', 'billing-v2', false, [agent('s3', 'claude-code'), agent('cc-9', 'claude-code', { source: 'claude-log', lastSeen: null })]),
    ]);
    await gotoWithProject(page);

    await chips(page).filter({ hasText: 'billing-v2' }).click();
    const pop = page.getByTestId('workstream-popover');
    await expect(pop).toBeVisible();
    await expect(pop).toContainText('Worktree, shared by 2 agents');
    await expect(pop).toContainText('/work/acme-billing');
    await expect(pop).toContainText('worktree of its own');
    await expect(pop.getByTestId('workstream-agent')).toHaveCount(2);
    await expect(pop.getByTestId('workstream-agent').nth(1)).toContainText('from its log');
    await shot(page, 'workstreams-shared-detail');

    // Another chip swaps the details; Escape closes them.
    await chips(page).filter({ hasText: 'auth-refresh' }).click();
    await expect(pop).toContainText('/work/acme-auth');
    await expect(pop).not.toContainText('shared by');
    await expect(pop).toContainText('gpt-5');
    await shot(page, 'workstreams-detail');
    await page.keyboard.press('Escape');
    await expect(pop).toHaveCount(0);
  });

  test('more than five collapse into +N, which lists the rest', async ({ page }) => {
    const many = ['a', 'b', 'c', 'd', 'e', 'f', 'g'].map((b, i) => ws(`/work/acme-${b}`, `feature-${b}`, false, [agent(`s${i}`, 'claude-code')]));
    await serve(page, many);
    await gotoWithProject(page);
    await expect(chips(page)).toHaveCount(4);
    const more = page.getByTestId('workstream-overflow');
    await expect(more).toHaveText('+3');
    await more.click();
    await expect(page.getByTestId('workstream-popover')).toContainText('feature-e');
    await expect(page.getByTestId('workstream-popover')).toContainText('feature-g');
    await expect(page.getByTestId('workstream-popover')).not.toContainText('feature-a');
  });
});
