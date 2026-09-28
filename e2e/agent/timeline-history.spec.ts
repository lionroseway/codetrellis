/**
 * The Timeline keeps what agents did (Phase 32 B1).
 *
 * Agent activity used to live only in the window: open it after the agent
 * worked, or reload it, and the Timeline was empty. Now the backend keeps
 * the record, and the window loads it when it connects. The agent here
 * works in Node, before the page exists, as a real one does.
 */

import fs from 'node:fs';
import path from 'node:path';
import { test, expect } from '@playwright/test';
import { gotoWithProject, seedPlan, cleanupPlans, API, authHeaders } from '../helpers/setup';
import { createMcpClient } from '../helpers/mcp-client';

const OUT = path.join('test-results', 'ux-audit');

test.describe('Timeline history', () => {
  test('what an agent did before the window opened is in the Timeline, and still there after a reload', async ({ page }) => {
    const marker = `b1History${Date.now()}`;
    const agent = await createMcpClient();
    try {
      await agent.callTool('search_symbols', { query: marker });
    } finally {
      agent.close();
    }

    await gotoWithProject(page);
    await page.locator('button:has-text("Timeline")').first().click();
    const row = page.getByText(`Looked for \`${marker}\``);
    await expect(row.first()).toBeVisible({ timeout: 10_000 });
    fs.mkdirSync(OUT, { recursive: true });
    await page.screenshot({ path: path.join(OUT, 'timeline-history.png') });

    await page.reload();
    await page.locator('button:has-text("Timeline")').first().click();
    await expect(page.getByText(`Looked for \`${marker}\``).first()).toBeVisible({ timeout: 10_000 });
    // Loaded once, not once per connection: one row for it (the "Last
    // activity" line above the rows says the same words).
    await expect(page.getByRole('button', { name: new RegExp(`Looked for \`${marker}\``) })).toHaveCount(1);
  });

  test('a spec edited, and a call the server refused, are in the Timeline too (B1.2)', async ({ page, request }) => {
    const title = `B1.2 spec ${Date.now()}`;
    const plan = await seedPlan(request, { title: 'E2E B1.2 Timeline plan' });
    try {
      const doc = (await (await request.post(`${API}/plans/${plan.uid}/docs`, { headers: authHeaders(), data: { docType: 'spec', title, body: 'v1' } })).json()) as { uid: string };
      await request.put(`${API}/plan-docs/${doc.uid}`, { headers: authHeaders(), data: { body: 'v2: rotate on every use' } });
      const agent = await createMcpClient();
      try {
        await agent.callTool('get_app_guide', { flavor: 'not-a-flavour' }).catch(() => undefined);
      } finally {
        agent.close();
      }

      await gotoWithProject(page);
      await page.locator('button:has-text("Timeline")').first().click();
      await expect(page.getByText(`Edited the spec “${title}” (v2)`).first()).toBeVisible({ timeout: 10_000 });
      await expect(page.getByText(/Get app guide failed/).first()).toBeVisible();
      fs.mkdirSync(OUT, { recursive: true });
      await page.screenshot({ path: path.join(OUT, 'timeline-edits-refusals.png') });
    } finally {
      await cleanupPlans(request, 'E2E B1.2 Timeline plan');
    }
  });
});
