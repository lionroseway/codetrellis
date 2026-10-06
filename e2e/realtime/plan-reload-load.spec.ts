/**
 * Phase 33 S3 — the window under load, end to end: a pull touching every
 * task file of five plans of forty actions each, through the real backend
 * and watcher. The window takes it as one: one notice naming the five
 * plans, the plan list fetched once (twice if the burst straddles the
 * one-second cap), and no plan fetched once per file.
 */

import fs from 'node:fs';
import path from 'node:path';
import { test, expect } from '@playwright/test';
import { gotoWithProject, seedPlan, cleanupPlans, authHeaders, API, PROJECT_PATH } from '../helpers/setup';

const PREFIX = 'E2E Reload Load';
const PLANS = 5;
const ACTIONS = 40;

function yamlFilesUnder(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = path.join(dir, e.name);
    return e.isDirectory() ? yamlFilesUnder(p) : e.name.endsWith('.yaml') ? [p] : [];
  });
}

test.describe('Plan reload under load', () => {
  test.afterEach(async ({ request }) => {
    await cleanupPlans(request, PREFIX);
  });

  test(`a pull touching ${PLANS} plans of ${ACTIONS} actions is one notice and one plan-list refetch`, async ({ page, request }) => {
    test.setTimeout(180_000);
    const planDirs: string[] = [];
    for (let p = 1; p <= PLANS; p++) {
      const plan = await seedPlan(request, {
        title: `${PREFIX} ${p}`,
        actions: Array.from({ length: ACTIONS }, (_, i) => ({ title: `Plan ${p} action ${i + 1}` })),
      });
      const res = await request.post(`${API}/plans/${plan.uid}/export?path=${encodeURIComponent(PROJECT_PATH)}`, { headers: authHeaders() });
      expect(res.ok(), await res.text()).toBe(true);
      planDirs.push((await res.json()).planDir);
    }

    await gotoWithProject(page);
    await page.waitForTimeout(1500);

    let listFetches = 0;
    const perPlan = new Map<string, number>();
    page.on('request', (r) => {
      if (r.method() !== 'GET') return;
      const u = new URL(r.url());
      if (u.pathname === '/api/plans') listFetches += 1;
      const one = /^\/api\/plans\/([^/]+)$/.exec(u.pathname);
      if (one) perPlan.set(one[1], (perPlan.get(one[1]) ?? 0) + 1);
    });

    let changed = 0;
    for (const dir of planDirs) {
      for (const f of yamlFilesUnder(dir)) {
        fs.appendFileSync(f, `\n# touched by ${PREFIX}\n`);
        changed += 1;
      }
    }
    expect(changed).toBeGreaterThanOrEqual(PLANS * ACTIONS);

    const stack = page.getByTestId('toast-stack');
    await expect(stack.getByText(`${PLANS} plans reloaded from disk`)).toBeVisible({ timeout: 30_000 });
    await page.waitForTimeout(2500);

    await expect(stack.getByText(/reloaded from disk/)).toHaveCount(1);
    expect(listFetches).toBeGreaterThanOrEqual(1);
    expect(listFetches).toBeLessThanOrEqual(2);
    // No plan is fetched anywhere near once per file.
    for (const [uid, n] of perPlan) expect(n, `fetches of plan ${uid}`).toBeLessThanOrEqual(4);
  });
});
