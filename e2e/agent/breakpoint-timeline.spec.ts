/**
 * A breakpoint on the Timeline (Phase 32 B4.1).
 *
 * A person sets a breakpoint on a task; a real agent claims it and is
 * paused; the person answers with a steer; the agent's next claim goes
 * through. The Timeline says each step in words: the pause in the agent's
 * turn, and the answer, with its note. (Setting and answering from the
 * window is B4.3; here they go over the API, as the phone and scripts do.)
 */

import fs from 'node:fs';
import path from 'node:path';
import { test, expect } from '@playwright/test';
import { gotoWithProject, seedPlan, cleanupPlans, API, authHeaders } from '../helpers/setup';
import { createMcpClient } from '../helpers/mcp-client';
import type { AgentEvent, Workstream } from '../../src/shared/types';

const OUT = path.join('test-results', 'ux-audit');
const PLAN = 'E2E B4.1 breakpoint plan';

test.describe('Breakpoints on the Timeline', () => {
  test('a paused claim and the steer that let it through read as words in the Timeline', async ({ page, request }) => {
    const title = `Partial refunds ${Date.now()}`;
    const plan = await seedPlan(request, { title: PLAN, actions: [{ title }] });
    const task = plan.actionUids[0];
    let bp: string | null = null;
    const agent = await createMcpClient();
    try {
      const set = await request.post(`${API}/breakpoints`, { headers: authHeaders(), data: { kind: 'task', itemUid: task, note: 'Ask me before touching payments' } });
      expect(set.status()).toBe(201);
      bp = ((await set.json()) as { breakpoint: { id: string } }).breakpoint.id;

      const paused = JSON.parse((await agent.callTool('claim_item', { uid: task })).content[0].text);
      expect(paused).toMatchObject({ paused: true, status: 'paused: waiting for a decision' });
      const answer = await request.post(`${API}/breakpoint-hits/${paused.ref}/answer`, {
        headers: authHeaders(), data: { decision: 'steer', note: "Go ahead, but don't change the refund path" },
      });
      expect(answer.ok()).toBe(true);
      const claimed = (await agent.callTool('claim_item', { uid: task })).content.map((c: { text: string }) => c.text).join('\n');
      expect(claimed).toContain('with this steer');

      await gotoWithProject(page);
      await page.getByRole('button', { name: /^Timeline( \d+)?$/ }).click();
      await expect(page.getByText(`Paused at a breakpoint before claiming “${title}”`).first()).toBeVisible({ timeout: 10_000 });
      const steer = page.getByText(`said continue claiming “${title}”, with a steer: “Go ahead, but don't change the refund path”`).first();
      await expect(steer).toBeVisible();
      // The photograph: scrolled to the pause and the answer, below the lanes.
      await steer.scrollIntoViewIfNeeded();
      fs.mkdirSync(OUT, { recursive: true });
      await page.screenshot({ path: path.join(OUT, 'breakpoint-timeline.png') });
    } finally {
      agent.close();
      if (bp) await request.delete(`${API}/breakpoints/${bp}`, { headers: authHeaders() });
      await cleanupPlans(request, PLAN);
    }
  });

  test('on code: a paused edit and a breach read differently, and a breach is never called a pause (B4.2)', async ({ page }) => {
    const now = Date.now();
    const ws = (root: string, branch: string, agentType: string, sessionId: string): Workstream => ({
      root, branch, head: '3f9c2e1a7b', main: false, shape: 'worktree', idle: false,
      agents: [{ sessionId, agentType, model: null, source: 'mcp', lastSeen: now - 5_000 }],
      changes: { base: '9a8b7c6d5e4f3a2b1c0d9e8f7a6b5c4d3e2f1a0b', files: [{ path: 'packages/shared/src/validators.ts', status: 'modified' }], truncated: false },
    });
    const room = [ws('/work/acme-billing', 'billing-v2', 'claude-code', 's-bill'), ws('/work/acme-exports', 'exports', 'codex', 's-exp')];
    const file = 'packages/shared/src/validators.ts';
    const history: AgentEvent[] = [
      { id: 'b42-1', timestamp: now - 9 * 60_000, source: 'app', type: 'breakpoint_hit', payload: { action: 'edit_code', path: file, agentType: 'claude-code-hook', workstreamRoot: '/work/acme-billing' } },
      { id: 'b42-2', timestamp: now - 6 * 60_000, source: 'app', type: 'breakpoint_answered', payload: { action: 'edit_code', path: file, decision: 'steer', note: 'Only the email rule', byType: 'human', agentType: 'human', workstreamRoot: '/work/acme-billing' } },
      { id: 'b42-3', timestamp: now - 3 * 60_000, source: 'app', type: 'breakpoint_hit', payload: { action: 'breach', breach: true, path: file, agentType: 'codex', workstreamRoot: '/work/acme-exports' } },
      { id: 'b42-4', timestamp: now - 60_000, source: 'app', type: 'breakpoint_answered', payload: { action: 'breach', breach: true, path: file, decision: 'stop', note: 'Revert it, shared is frozen', byType: 'human', agentType: 'human', workstreamRoot: '/work/acme-exports' } },
    ];
    await page.route('**/api/workstreams?*', (route) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(room) }));
    await page.route('**/api/workstreams/commits?*', (route) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ since: now - 60 * 60_000, commits: {} }) }));
    await page.route('**/api/awareness?*', (route) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ signals: [] }) }));
    await page.route('**/api/agent-events?*', (route) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ events: history }) }));

    await gotoWithProject(page);
    await page.getByRole('button', { name: /^Timeline( \d+)?$/ }).click();
    await expect(page.getByText(`Paused at a breakpoint before changing “${file}”`).first()).toBeVisible({ timeout: 10_000 });
    await expect(page.getByText(`You said continue changing “${file}”, with a steer: “Only the email rule”`).first()).toBeVisible();
    const breach = page.getByText(`Changed “${file}” past a breakpoint: a breach, it could not be paused`).first();
    await expect(breach).toBeVisible();
    await expect(page.getByText(`You said stop to changing “${file}”: “Revert it, shared is frozen”`).first()).toBeVisible();
    await breach.scrollIntoViewIfNeeded();
    fs.mkdirSync(OUT, { recursive: true });
    await page.screenshot({ path: path.join(OUT, 'breakpoint-code-timeline.png') });
  });
});
