/**
 * The trace has to run both ways.
 *
 * Reading code, you could click "this item wants this file" and land on
 * the plan item. Nothing brought you back. The only route was the top
 * bar's Code button — a mode toggle that does not know which file you
 * were reading — so following the trace cost you your place, and the
 * journey the product is built around dead-ended after one hop.
 *
 * This walks the whole round trip on the real surfaces: open a file,
 * follow the marker to the item, come back, and land on the same file.
 * Each half worked in isolation before; the join is what did not exist,
 * and a join is exactly what a per-component spec cannot see.
 */

import fs from 'node:fs';
import path from 'node:path';
import { test, expect } from '@playwright/test';
import { gotoWithProject, cleanupPlans, authHeaders, API } from '../helpers/setup';

const PROJECT = path.resolve(process.cwd(), 'tests/fixtures/sample-app');
const TARGET = 'services/shared-go/money/money.go';
const TITLE = 'E2E RoundTrip Rounding';

test.describe('code and plan, both directions', () => {
  test.afterEach(async ({ request }) => {
    await cleanupPlans(request, 'E2E RoundTrip');
  });

  test('a file leads to its item, and the item leads back to the file', async ({ page }) => {
    // Open the project FIRST. Plan writes are confined to projects this
    // app has opened — creating one against an unopened path is a 403,
    // which is the rule working, not a test problem.
    await gotoWithProject(page, { projectPath: PROJECT });

    // Seed a plan whose item targets a file that really exists, so the
    // overlay has something to anchor to.
    const planRes = await page.request.post(`${API}/plans`, {
      headers: authHeaders(),
      data: { title: TITLE, description: '', projectPath: PROJECT },
    });
    expect(planRes.ok(), `POST /api/plans -> ${planRes.status()}`).toBeTruthy();
    const plan = (await planRes.json()) as { uid: string };

    const itemRes = await page.request.post(`${API}/plans/${plan.uid}/items`, {
      headers: authHeaders(),
      data: {
        kind: 'action',
        title: 'Align rounding in the Go money package',
        template: 'action',
        status: 'in_progress',
        fileSpecs: [{ path: TARGET, action: 'modify' }],
      },
    });
    expect(itemRes.ok(), `POST items -> ${itemRes.status()}`).toBeTruthy();

    // Open the file in the code reader the way the app does internally.
    await page.evaluate(
      ([abs]) => {
        window.dispatchEvent(new CustomEvent('__test_open_file__', { detail: { path: abs } }));
      },
      [path.join(PROJECT, TARGET)],
    );

    await page.waitForTimeout(1800);

    // The banner naming the item that wants this file.
    const banner = page.getByText('wants this file').first();
    await expect(banner, 'the code reader should name the item that wants this file')
      .toBeVisible({ timeout: 8000 });

    // Follow it.
    await page.getByRole('button', { name: /Align rounding/ }).first().click();
    await page.waitForTimeout(1500);

    // We are on the item.
    const itemTitle = page.locator('input[placeholder="Untitled"]').first();
    await expect(itemTitle).toBeVisible({ timeout: 8000 });
    await expect(itemTitle).toHaveValue(/Align rounding/);

    // And the way back exists, names the file, and works. Before this
    // change there was no such control at all.
    const back = page.locator('button[title*="money.go"]').first();
    await expect(back, 'the plan header should offer a way back to the file')
      .toBeVisible({ timeout: 8000 });
    await back.click();
    await page.waitForTimeout(1500);

    await expect(
      page.getByText('wants this file').first(),
      'clicking back should land on the file we came from, not the graph',
    ).toBeVisible({ timeout: 8000 });
  });

  test('a changed line is visibly changed', async ({ page }) => {
    // The complaint that started this: the tint was 4% opacity. Assert on
    // the rendered style rather than a class name, so a future refactor
    // that keeps the class and loses the colour still fails.
    const abs = path.join(PROJECT, TARGET);
    const original = fs.readFileSync(abs, 'utf-8');
    fs.writeFileSync(abs, `${original}\n// round-trip probe\n`);

    try {
      await gotoWithProject(page, { projectPath: PROJECT });
      await page.evaluate(
        ([p]) => {
          window.dispatchEvent(new CustomEvent('__test_open_file__', { detail: { path: p } }));
        },
        [abs],
      );
      await page.waitForTimeout(2200);

      // Some row must carry a non-transparent verdict tint.
      const tinted = await page.evaluate(() => {
        // Tailwind 4 emits oklab(), not rgba(), so read the alpha out of
        // whatever colour function the browser reports rather than
        // assuming one. A parser that only knows rgba() reports "no
        // tint" on a perfectly tinted row.
        const alphaOf = (bg: string): number => {
          const slash = bg.match(/\/\s*([\d.]+)\s*\)/);
          if (slash) return parseFloat(slash[1]);
          const rgba = bg.match(/rgba?\(([^)]+)\)/);
          if (!rgba) return 0;
          const parts = rgba[1].split(',').map((x) => parseFloat(x));
          return parts.length > 3 ? parts[3] : 1;
        };
        return Array.from(document.querySelectorAll('pre div'))
          .some((r) => alphaOf(getComputedStyle(r).backgroundColor) >= 0.08);
      });
      expect(tinted, 'no line was tinted strongly enough to notice').toBeTruthy();
    } finally {
      fs.writeFileSync(abs, original);
    }
  });
});
