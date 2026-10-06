/**
 * Phase 33 G4 — the graph full screen and back.
 *
 * The owner: "graph view panel be full screen or bring back". A button on
 * the canvas toolbar and ⌘⇧F hide the sidebar, the inspector and the plan
 * panel, and the canvas takes the room; the same again puts back exactly the
 * panels that were showing, and the layout matches. A hidden panel leaves
 * no empty pane behind (its Allotment pane collapses with it).
 */

import { test, expect, type Page } from '@playwright/test';
import { gotoWithProject } from '../helpers/setup';

const canvasBox = async (page: Page) => (await page.locator('.react-flow').first().boundingBox())!;

test.describe('Graph full screen', () => {
  test.use({ viewport: { width: 1440, height: 900 } });

  test('the button hides the side panels, the canvas takes the room, and the same again restores the layout', async ({ page }) => {
    await gotoWithProject(page);
    await expect.poll(() => page.locator('.react-flow__node').count(), { timeout: 15_000 }).toBeGreaterThan(0);
    const sidebar = page.getByTestId('explorer-tree');
    await expect(sidebar).toBeVisible();
    const before = await canvasBox(page);

    const button = page.getByTestId('graph-full-screen');
    await button.click();
    await expect(button).toHaveAttribute('aria-pressed', 'true');
    await expect(sidebar).toHaveCount(0);
    await expect.poll(async () => (await canvasBox(page)).width).toBeGreaterThan(1400);
    await expect.poll(async () => (await canvasBox(page)).x).toBeLessThan(5);

    await button.click();
    await expect(button).toHaveAttribute('aria-pressed', 'false');
    await expect(sidebar).toBeVisible();
    await expect.poll(async () => Math.round((await canvasBox(page)).x)).toBe(Math.round(before.x));
    await expect.poll(async () => Math.abs((await canvasBox(page)).width - before.width)).toBeLessThan(4);
  });

  test('⌘⇧F does the same, and a panel hidden before full screen stays hidden after', async ({ page }) => {
    await gotoWithProject(page);
    await expect.poll(() => page.locator('.react-flow__node').count(), { timeout: 15_000 }).toBeGreaterThan(0);
    // Hide the sidebar first, with ⌘B; its pane goes with it, leaving no gap.
    await page.keyboard.press('ControlOrMeta+b');
    await expect(page.getByTestId('explorer-tree')).toHaveCount(0);
    await expect.poll(async () => (await canvasBox(page)).x).toBeLessThan(5);

    await page.keyboard.press('ControlOrMeta+Shift+F');
    await expect(page.getByTestId('graph-full-screen')).toHaveAttribute('aria-pressed', 'true');
    await page.keyboard.press('ControlOrMeta+Shift+F');
    await expect(page.getByTestId('graph-full-screen')).toHaveAttribute('aria-pressed', 'false');
    // Still hidden: it was hidden before.
    await expect(page.getByTestId('explorer-tree')).toHaveCount(0);
    await page.keyboard.press('ControlOrMeta+b');
    await expect(page.getByTestId('explorer-tree')).toBeVisible();
  });
});
