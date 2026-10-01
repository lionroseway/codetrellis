/**
 * Teammates' plans after a pull, from the window (Phase 32 C2.6a).
 *
 * Dana pulls. Priya's "Q4 forecast" is in her plans list "from Priya Shah,
 * in 3f9c2e1", as git says it arrived; her own "Board pack" says nothing of
 * the kind; a folder copied in but not committed yet says so.
 *
 * The arrivals are given on the real list (the backend's side, with a real
 * commit and import, is tests/e2e/plan-arrivals.test.ts).
 */

import fs from 'node:fs';
import path from 'node:path';
import { test, expect } from '@playwright/test';
import { gotoWithProject, seedPlan, cleanupPlans } from '../helpers/setup';

const OUT = path.join('test-results', 'ux-audit');
const PREFIX = 'E2E C2.6a';

test.describe('Teammates\' plans after a pull', () => {
  test.afterEach(async ({ request }) => {
    for (const t of ['Q4 forecast', 'Board pack', 'Hiring plan']) await cleanupPlans(request, `${PREFIX} ${t}`);
  });

  test('a teammate\'s plan says who added it and in which commit; your own says nothing', async ({ page, request }) => {
    const forecast = await seedPlan(request, { title: `${PREFIX} Q4 forecast`, actions: [] });
    await seedPlan(request, { title: `${PREFIX} Board pack`, actions: [] });
    const hiring = await seedPlan(request, { title: `${PREFIX} Hiring plan`, actions: [] });
    const at = Date.now();
    await page.route((url) => url.pathname === '/api/plans', async (route) => {
      if (route.request().method() !== 'GET') return route.fallback();
      const res = await route.fetch();
      const plans = (await res.json()) as Array<{ uid: string; arrival?: unknown }>;
      const arrival: Record<string, unknown> = {
        [forecast.uid]: { addedBy: 'Priya Shah', commit: '3f9c2e1', arrivedAt: at },
        [hiring.uid]: { addedBy: null, commit: null, arrivedAt: at },
      };
      await route.fulfill({ response: res, json: plans.map((p) => ({ ...p, arrival: arrival[p.uid] ?? null })) });
    });

    await gotoWithProject(page);
    await page.getByRole('button', { name: 'Plans', exact: true }).first().click();
    const rowOf = (title: string) => page.locator('div.group').filter({ hasText: `${PREFIX} ${title}` }).first();
    await expect(rowOf('Q4 forecast').getByTestId('plan-arrival')).toHaveText('from Priya Shah, in 3f9c2e1');
    await expect(rowOf('Hiring plan').getByTestId('plan-arrival')).toHaveText('arrived in its files, not committed yet');
    await expect(rowOf('Board pack').getByTestId('plan-arrival')).toHaveCount(0);
    fs.mkdirSync(OUT, { recursive: true });
    await rowOf('Q4 forecast').scrollIntoViewIfNeeded();
    const boxes = (await Promise.all(['Q4 forecast', 'Board pack', 'Hiring plan'].map((t) => rowOf(t).boundingBox()))).filter((b): b is NonNullable<typeof b> => !!b);
    const x = Math.min(...boxes.map((b) => b.x));
    const y = Math.min(...boxes.map((b) => b.y));
    const clip = { x, y, width: Math.max(...boxes.map((b) => b.x + b.width)) - x, height: Math.max(...boxes.map((b) => b.y + b.height)) - y };
    await page.screenshot({ path: path.join(OUT, 'plan-arrivals.png'), clip });
  });
});
