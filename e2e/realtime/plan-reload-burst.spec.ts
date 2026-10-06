/**
 * Phase 33 S2 — the window takes a burst of plan reloads as one.
 *
 * The owner's report (0.1.17): "Plan reloaded from disk" fired so many times
 * the Mac froze. After S1 the backend sends one `plan-imported` per plan per
 * burst; a pull that touches three plans still sends three. The window
 * gathers them: one refetch of the plan list and one notice, which names how
 * many plans and files, instead of three of each.
 */

import fs from 'node:fs';
import path from 'node:path';
import { test, expect } from '@playwright/test';
import { gotoWithProject, seedPlan, cleanupPlans, authHeaders, API, PROJECT_PATH } from '../helpers/setup';

const PREFIX = 'E2E Reload Burst';

function yamlFilesUnder(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = path.join(dir, e.name);
    return e.isDirectory() ? yamlFilesUnder(p) : e.name.endsWith('.yaml') ? [p] : [];
  });
}

test.describe('Plan reload burst', () => {
  test.afterEach(async ({ request }) => {
    await cleanupPlans(request, PREFIX);
  });

  test('a pull touching three plans is one plan-list refetch and one notice in the window', async ({ page, request }) => {
    test.setTimeout(90_000);
    const planDirs: string[] = [];
    for (const name of ['A', 'B', 'C']) {
      const plan = await seedPlan(request, {
        title: `${PREFIX} ${name}`,
        actions: [{ title: `${name} one` }, { title: `${name} two` }],
      });
      const res = await request.post(`${API}/plans/${plan.uid}/export?path=${encodeURIComponent(PROJECT_PATH)}`, { headers: authHeaders() });
      expect(res.ok(), await res.text()).toBe(true);
      planDirs.push((await res.json()).planDir);
    }

    await gotoWithProject(page);
    // Past the backend's self-write window, so the edits read as a pull.
    await page.waitForTimeout(1500);

    let listFetches = 0;
    page.on('request', (r) => {
      const u = new URL(r.url());
      if (r.method() === 'GET' && u.pathname === '/api/plans') listFetches += 1;
    });

    // Every file of all three plans at once, as a pull does. A comment line
    // changes the file without changing what it says.
    let changed = 0;
    for (const dir of planDirs) {
      for (const f of yamlFilesUnder(dir)) {
        fs.appendFileSync(f, `\n# touched by ${PREFIX}\n`);
        changed += 1;
      }
    }
    expect(changed).toBeGreaterThanOrEqual(6);

    const stack = page.getByTestId('toast-stack');
    await expect(stack.getByText('3 plans reloaded from disk')).toBeVisible({ timeout: 15_000 });
    // Let anything still on its way arrive before counting.
    await page.waitForTimeout(2500);

    await expect(stack.getByText(/reloaded from disk/)).toHaveCount(1);
    await expect(stack.getByText(/files changed/)).toHaveCount(1);
    // One per burst; a second only if the burst straddled the window's one-second cap.
    expect(listFetches).toBeGreaterThanOrEqual(1);
    expect(listFetches).toBeLessThanOrEqual(2);
  });
});
