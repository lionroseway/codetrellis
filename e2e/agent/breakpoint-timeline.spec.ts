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
});
