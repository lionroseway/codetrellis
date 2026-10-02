/**
 * Phase 32 A6.1 — a task worked through its brief is a line of work in the
 * strip (awareness spec §10.1).
 *
 * A Claude Desktop session opens "Q3 summary" with get_brief. The strip
 * shows "Task · Q3 summary" with its agent; opening it says it is work that
 * is not code, in which plan, with what was recorded on it.
 */
import fs from 'node:fs';
import path from 'node:path';
import { test, expect, type Page } from '@playwright/test';
import { cleanupPlans, gotoWithProject, seedPlan } from '../helpers/setup';
import { createMcpClient } from '../helpers/mcp-client';

const OUT = path.join('test-results', 'ux-audit');

async function shot(target: Page | ReturnType<Page['getByTestId']>, name: string) {
  fs.mkdirSync(OUT, { recursive: true });
  await new Promise((r) => setTimeout(r, 300));
  await target.screenshot({ path: path.join(OUT, `${name}.png`) });
}

test.describe('A task as a line of work', () => {
  test.setTimeout(120_000);
  test.afterEach(async ({ request }) => { await cleanupPlans(request, 'E2E Task line'); });

  test('opening a brief puts the task in the strip, and its popover says what it is', async ({ page, request }) => {
    const plan = await seedPlan(request, { title: 'E2E Task line Quarter close', actions: [{ title: 'Q3 summary' }] });
    const agent = await createMcpClient();
    try {
      const brief = await agent.callTool('get_brief', { item_uid: plan.actionUids[0] });
      expect(brief.isError).toBeFalsy();

      await gotoWithProject(page);
      const chip = page.getByTestId('task-workstream-chip').filter({ hasText: 'Q3 summary' });
      await expect(chip).toBeVisible({ timeout: 20_000 });
      await expect(chip).toContainText('Task · Q3 summary');
      await chip.click();
      const pop = page.getByTestId('task-workstream-popover');
      await expect(pop).toBeVisible();
      await expect(pop).toContainText('A task in E2E Task line Quarter close');
      await expect(pop).toContainText('Work that is not code');
      await expect(pop).toContainText('0 materials · 0 outputs');
      await expect(pop.getByTestId('task-workstream-agent')).toHaveCount(1);
      await shot(page.getByTestId('workstream-strip'), 'task-workstream-chip');
      await shot(pop, 'task-workstream-popover');
    } finally {
      agent.close();
    }
  });
});
