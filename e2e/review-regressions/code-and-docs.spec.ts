/**
 * The two surfaces nobody had clicked through: Code mode and Docs.
 *
 * Code mode is where four of this pass's findings were (M11, M12, m10,
 * m11), all fixed without anyone driving the result. Docs has never been
 * exercised by any test in this repository.
 *
 * Release-gate shaped, not regression shaped: the question is "can a person
 * do the thing", not "is a specific bug gone".
 */

import path from 'node:path';
import { test, expect, type Page, type Locator } from '@playwright/test';
import { gotoWithProject } from '../helpers/setup';

const PROJECT_PATH = path.resolve(process.cwd(), 'tests/fixtures/sample-app');
const open = (page: Page) => gotoWithProject(page, { projectPath: PROJECT_PATH });

const codeSurface = (page: Page): Locator =>
  page.locator('div.absolute.inset-0.z-30.bg-background');

async function enterCodeMode(page: Page): Promise<Locator> {
  await page.getByRole('button', { name: 'Code', exact: true }).click();
  const surface = codeSurface(page);
  await surface.getByRole('button', { name: 'Source', exact: true }).waitFor({ timeout: 10_000 });
  return surface;
}

test.describe('Code mode — end to end', () => {
  test.setTimeout(90_000);

  test('the layout under code mode takes no clicks: its resize handles are beneath the surface', async ({ page }) => {
    // Allotment's handles are z-index 35 and the takeovers z-30. Sharing a
    // stacking context, the hidden layout's handles sat on top of code mode,
    // invisible, and took clicks meant for what lay under them: on macOS's
    // metrics, the Diff button.
    await open(page);
    await enterCodeMode(page);
    const stolen = await page.evaluate(() => {
      const surface = document.querySelector('div.absolute.inset-0.z-30');
      const out: string[] = [];
      for (const sash of Array.from(document.querySelectorAll('[data-testid="sash"]'))) {
        if (surface?.contains(sash)) continue; // code mode's own handles work as they should
        const r = sash.getBoundingClientRect();
        if (r.width === 0 || r.height === 0) continue;
        const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
        if (hit && !surface?.contains(hit)) out.push(`${Math.round(r.left)},${Math.round(r.top)} → ${hit.className}`);
      }
      return out;
    });
    expect(stolen).toEqual([]);
  });

  test('a file can be picked, read, and diffed without leaving the surface', async ({ page }) => {
    await open(page);
    const surface = await enterCodeMode(page);

    // A root-level file: `services/` holds only subdirectories, so its
    // children are not files and nothing matches one level down.
    const file = surface.getByRole('button', { name: /\.(json|md|sql|yaml)$/ }).first();
    await file.waitFor({ timeout: 10_000 });
    const name = ((await file.textContent()) ?? '').trim();
    await file.click();

    // Source renders actual code, not an error or an empty pane.
    await expect(surface.locator('span.font-mono').first()).toContainText(name, { timeout: 10_000 });
    await expect(surface.getByText(/File not found|Path is a directory|Could not read/)).toHaveCount(0);

    // Diff renders without a crash, and does not claim the whole file is
    // new — that confident wrong answer is exactly what m11 was about.
    await surface.getByRole('button', { name: 'Diff', exact: true }).click();
    await expect(surface.getByText(/Loading the diff editor/)).toHaveCount(0, { timeout: 20_000 });
    await expect(page.getByText('added in this range')).toHaveCount(0);

    // And back to source, so the toggle is a toggle.
    await surface.getByRole('button', { name: 'Source', exact: true }).click();
    await expect(surface.locator('span.font-mono').first()).toContainText(name);
  });

  test('the timeline opens and offers points to play through', async ({ page }) => {
    await open(page);
    const surface = await enterCodeMode(page);

    const file = surface.getByRole('button', { name: /\.(json|md|sql|yaml)$/ }).first();
    await file.waitFor({ timeout: 10_000 });
    await file.click();

    await surface.getByRole('button', { name: 'Timeline', exact: true }).click();
    // The bar appears and is not empty — an empty scrubber is the failure
    // mode M1 left behind when checkpoints sorted to epoch 0.
    await expect(surface.locator('input[type="range"]').or(surface.getByText(/Live \(working tree\)/)))
      .toBeVisible({ timeout: 20_000 });
  });

  test('leaving code mode brings the graph back', async ({ page }) => {
    await open(page);
    await enterCodeMode(page);
    await expect(page.locator('.react-flow')).toHaveCount(0);
    // The X in the code toolbar, not the TopBar button — a second way out
    // that should work the same.
    await codeSurface(page).getByTitle('Back to the graph').click();
    await expect(page.locator('.react-flow')).toHaveCount(1, { timeout: 10_000 });
  });
});

test.describe('Docs', () => {
  test.setTimeout(90_000);

  test('the docs surface opens and says something useful when empty', async ({ page }) => {
    await open(page);
    await page.getByRole('button', { name: 'Docs', exact: true }).click();

    // The fixture ships no system docs, so this is the empty state — which
    // still has to explain itself rather than render a blank panel.
    const surface = page.locator('body');
    await expect(surface.getByText(/doc/i).first()).toBeVisible({ timeout: 15_000 });
    // What the app itself wrote, never the repository's own words: the commit
    // picker lists this repository's commits, and a subject may say
    // "undefined" (#406's did, and a full clone failed here; CI's shallow one
    // did not).
    const leaks = await page.evaluate(() => {
      const found: string[] = [];
      const walk = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
      for (let n = walk.nextNode(); n; n = walk.nextNode()) {
        if (n.parentElement?.closest('select, option')) continue;
        if (/undefined|NaN|\[object Object\]/.test(n.textContent ?? '')) found.push(n.textContent ?? '');
      }
      return found;
    });
    expect(leaks).toEqual([]);
  });
});
