/**
 * Phase 33 follow-up — the panes resize when asked, and never on load.
 *
 * Since Phase 31 every load logged "[App] plan panel resize failed" and
 * "[App] inspector resize failed": Cannot read properties of undefined
 * (reading 'minimumSize'). Each effect skipped its first run with a
 * "mounted" ref, but StrictMode runs an effect twice on mount and keeps the
 * ref, so the second run resized while Allotment was still putting its panes
 * back. The effects now resize only when what they follow changes.
 */

import { test, expect, type Page } from '@playwright/test';
import { gotoWithProject } from '../helpers/setup';

const RESIZE_FAILED = /resize failed|pane restore failed|minimumSize/;

const watchConsole = (page: Page) => {
  const said: string[] = [];
  page.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') said.push(m.text().slice(0, 300)); });
  return said;
};

test.describe('Panes resize', () => {
  test.use({ viewport: { width: 1440, height: 900 } });

  test('nothing is resized on load, and expanding and collapsing the plan panel resizes it, with nothing failing', async ({ page }) => {
    const said = watchConsole(page);
    await gotoWithProject(page);
    await expect.poll(() => page.locator('.react-flow__node').count(), { timeout: 15_000 }).toBeGreaterThan(0);
    // The effects run on the frame after mount; give them two.
    await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
    expect(said.filter((s) => RESIZE_FAILED.test(s)), 'nothing failed to resize on load').toEqual([]);

    const canvas = page.locator('.react-flow').first();
    const before = (await canvas.boundingBox())!;

    // The plan panel, expanded: the canvas above it gives up height.
    await page.getByTitle('Expand panel').first().click();
    await expect.poll(async () => (await canvas.boundingBox())!.height).toBeLessThan(before.height - 50);
    const expanded = (await canvas.boundingBox())!.height;
    // Collapsed again: the panel goes back to its default height, so the canvas has its room back.
    await page.getByTitle('Collapse panel').first().click();
    await expect.poll(async () => (await canvas.boundingBox())!.height).toBeGreaterThan(expanded + 50);

    expect(said.filter((s) => RESIZE_FAILED.test(s)), 'nothing failed to resize when asked').toEqual([]);
  });
});
