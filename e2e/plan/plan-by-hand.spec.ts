/**
 * B1 — a person plans the work by hand, start to finish.
 *
 * Everything else that drives a plan in this repo drives it as an agent:
 * MCP call, MCP call, MCP call. That is half the product. The other half
 * is somebody sitting in front of the app deciding what to do, and the
 * pieces of that have specs each (create, templates, item tree, targets,
 * export) with nothing walking the whole thing in one go.
 *
 * That gap matters because the failures live at the joins. A target
 * picked with the mouse has to write the same path shape that review
 * later matches on, or "did it land?" answers no for work that landed.
 * An export has to produce a directory the app can read back, not just a
 * 200. Neither is visible from inside a single-component spec.
 *
 * So this is one continuous journey, in order, on the real surface:
 * create → page → task → anchor a real file → change scope mid-flight →
 * share it to the repo → confirm what is on disk.
 */

import fs from 'node:fs';
import path from 'node:path';
import { test, expect } from '@playwright/test';
import { gotoWithProject, cleanupPlans, authHeaders, API } from '../helpers/setup';

const PROJECT = path.resolve(process.cwd(), 'tests/fixtures/sample-app');
const TITLE = 'E2E ByHand Rounding';
/** A file that genuinely exists in the fixture, so the picker can find it. */
const TARGET_FILE = 'money.go';

test.describe('planning by hand', () => {
  test.afterEach(async ({ request }) => {
    await cleanupPlans(request, 'E2E ByHand');
    fs.rmSync(path.join(PROJECT, '.codetrellis', 'plans'), { recursive: true, force: true });
  });

  test('a person can plan a change and put it in the repo', async ({ page }) => {
    await gotoWithProject(page, { projectPath: PROJECT });

    // ── create ────────────────────────────────────────────────────
    await page.getByRole('button', { name: 'Plans', exact: true }).first().click();
    await page.locator('button:has-text("New plan")').click();
    const titleBox = page.locator('input[placeholder="Untitled plan"]');
    await expect(titleBox).toBeVisible({ timeout: 5000 });
    await titleBox.fill(TITLE);
    await page.keyboard.press('Tab');
    await page.waitForTimeout(1200);

    const planUid = await findPlanUid(page, TITLE);
    expect(planUid, 'the plan the user just typed a title into should exist').toBeTruthy();

    // ── a page, for the thinking ──────────────────────────────────
    // A plan is not only a list of edits. The page is where the reason
    // lives, and it must be distinguishable from an action — which is
    // the thing that was wrong when pages and actions both counted as
    // "0/0 actions".
    await page.locator('button:has-text("Page")').first().click();
    await page.waitForTimeout(800);

    // ── a task, for the work ──────────────────────────────────────
    const newBtn = page.locator('button').filter({ hasText: /^\+?\s*New$/ }).first();
    if (await newBtn.isVisible().catch(() => false)) {
      await newBtn.click();
      await page.waitForTimeout(300);
    }
    const taskBtn = page.locator('button:has-text("Task")').first();
    await taskBtn.click();
    await page.waitForTimeout(900);

    const items = await listItems(page, planUid!);
    expect(items.filter((i) => i.kind === 'object').length, 'the page').toBeGreaterThanOrEqual(1);
    expect(items.filter((i) => i.kind === 'action').length, 'the task').toBeGreaterThanOrEqual(1);

    // ── name the task, the way a person would ─────────────────────
    const action = items.find((i) => i.kind === 'action')!;
    await page.getByText(action.title).first().click();
    await page.waitForTimeout(500);
    const itemTitle = page.locator('input[placeholder="Untitled"]').first();
    await expect(itemTitle).toBeVisible({ timeout: 5000 });
    await itemTitle.fill('Round half-up in the Go money package');
    await page.keyboard.press('Tab');
    await page.waitForTimeout(900);

    // ── anchor it to a real file with the picker ──────────────────
    // The assertion that matters is not that a chip appeared: it is
    // that the path stored is one review can match. A picker that
    // writes an absolute path, or a display label, looks identical on
    // screen and makes every review say "missing".
    const addTarget = page.locator('button[title="Add a file, symbol, or edge target"]').first();
    await expect(addTarget).toBeVisible({ timeout: 5000 });
    await addTarget.click();

    const search = page.locator('input[placeholder*="type to search files"]');
    await expect(search).toBeVisible({ timeout: 5000 });
    await search.fill(TARGET_FILE);
    const firstRow = page.locator('button[data-anchor-row]').first();
    await expect(firstRow, 'the picker should find a file that exists in the fixture')
      .toBeVisible({ timeout: 8000 });
    await firstRow.click();
    await page.waitForTimeout(1500);

    // The list endpoint returns summaries, which carry no fileSpecs —
    // the anchor has to be read from the item itself.
    const anchored = await getItem(page, action.uid);
    const specs = anchored?.fileSpecs ?? [];
    expect(specs.length, 'picking a file should anchor the item to it').toBeGreaterThanOrEqual(1);
    const stored = specs[0].path;
    expect(stored, `stored path was "${stored}"`).toContain(TARGET_FILE);
    expect(
      path.isAbsolute(stored),
      'an absolute path here would never match a review, which works in repo-relative terms',
    ).toBeFalsy();

    // ── scope changes mid-flight, as it does ──────────────────────
    await itemTitle.fill('Round half-up in the Go money package (and say so in the docs)');
    await page.keyboard.press('Tab');
    await page.waitForTimeout(900);
    const renamed = await getItem(page, action.uid);
    expect(renamed?.title).toContain('and say so in the docs');
    expect(renamed?.fileSpecs?.length, 'renaming must not drop the anchor').toBeGreaterThanOrEqual(1);

    // ── share it to the repo ──────────────────────────────────────
    // The sharing chip lives on the plan's own page, not on an item's.
    // Clicking the plan's name in the header is the way back — and until
    // this journey existed, there was no way back at all.
    await page.locator(`button[title="Back to ${TITLE}"]`).click();
    await page.waitForTimeout(900);
    // "Local" and "Shared" are the chip's two states; clicking it is
    // the only export affordance a person has.
    // Match the sync chip by its tooltip, not by the word "Shared" —
    // the share MENU in the same header also says "Shared", and a
    // loose locator matched that instead and "passed" instantly while
    // the export was still in flight.
    const chip = page.locator('button[title^="Local —"]');
    await expect(chip).toBeVisible({ timeout: 5000 });
    await Promise.all([
      page.waitForResponse((r) => r.url().includes('/export') && r.request().method() === 'POST'),
      chip.click(),
    ]);
    await expect(page.locator('button[title^="Shared —"]')).toBeVisible({ timeout: 8000 });

    // ── and confirm what is actually on disk ──────────────────────
    const plansDir = path.join(PROJECT, '.codetrellis', 'plans');
    expect(fs.existsSync(plansDir), `${plansDir} should exist after sharing`).toBeTruthy();
    const slugs = fs.readdirSync(plansDir);
    expect(slugs.length, 'a shared plan should be a directory under .codetrellis/plans/').toBeGreaterThan(0);

    const written = slugs
      .flatMap((slug) => walk(path.join(plansDir, slug)))
      .map((f) => fs.readFileSync(f, 'utf-8'))
      .join('\n');
    expect(written, 'the exported plan should carry the title the user typed').toContain(TITLE);
    expect(written, 'and the file the user anchored').toContain(TARGET_FILE);

    // Read it back the way the app would on another machine.
    const discovered = await page.request.get(
      `${API}/plans/discover?project=${encodeURIComponent(PROJECT)}`,
      { headers: authHeaders() },
    );
    expect(discovered.ok(), `discover -> ${discovered.status()}`).toBeTruthy();
    // `discover` answers with directories, not titles — the slug is how
    // the plan is named on disk.
    const found = JSON.stringify(await discovered.json());
    expect(found, 'a plan written to the repo must be discoverable from it')
      .toContain('e2e-byhand-rounding');
  });
});

// ── helpers ─────────────────────────────────────────────────────────

interface Item {
  uid: string;
  kind: string;
  title: string;
  fileSpecs?: Array<{ path: string; action: string }>;
}

async function findPlanUid(page: import('@playwright/test').Page, title: string) {
  const res = await page.request.get(`${API}/plans`, { headers: authHeaders() });
  const plans = (await res.json()) as Array<{ uid: string; title: string; status: string }>;
  return plans.find((p) => p.title === title && p.status !== 'archived')?.uid;
}

async function getItem(page: import('@playwright/test').Page, uid: string): Promise<Item | undefined> {
  const res = await page.request.get(`${API}/items/${uid}`, { headers: authHeaders() });
  if (!res.ok()) return undefined;
  return (await res.json()) as Item;
}

async function listItems(page: import('@playwright/test').Page, planUid: string): Promise<Item[]> {
  const res = await page.request.get(`${API}/plans/${planUid}/items`, { headers: authHeaders() });
  if (!res.ok()) return [];
  const body = await res.json();
  return Array.isArray(body) ? body : (body.items ?? []);
}

function walk(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
    e.isDirectory() ? walk(path.join(dir, e.name)) : [path.join(dir, e.name)],
  );
}
