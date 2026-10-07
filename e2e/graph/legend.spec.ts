/**
 * Phase 33 G2 — the legend says what the graph draws, and only that.
 *
 * The owner: "would be good on graph and other areas to have a color legend
 * so can understand what is going on". The graph's legend lists the states
 * on screen: turn import edges off and their entry goes. Hovering an entry
 * dims everything that does not draw it. Collapsed, it stays collapsed.
 */

import { test, expect } from '@playwright/test';
import { gotoWithProject } from '../helpers/setup';

test.describe('The graph legend', () => {
  test('an entry is listed only while its state is drawn; hovering lights what draws it; collapsed is remembered', async ({ page }) => {
    await gotoWithProject(page);
    await expect.poll(() => page.locator('.react-flow__edge').count(), { timeout: 15_000 }).toBeGreaterThan(0);
    const legend = page.getByTestId('legend-graph');
    const imports = legend.locator('[data-testid="legend-entry"][data-key="edge:import"]');
    await expect(imports).toHaveText(/imports/);

    // Import edges off: nothing draws them, so the legend stops listing them.
    await page.getByTestId('graph-edges').click();
    await page.getByTestId('edges-imports').uncheck();
    await expect(imports).toHaveCount(0);
    await page.getByTestId('edges-imports').check();
    await expect(imports).toHaveCount(1);
    await page.keyboard.press('Escape');

    // Hovering an entry dims what does not draw it.
    await imports.hover();
    await expect(page.getByTestId('legend-dim')).toHaveCount(1);
    const nodeOpacity = await page.locator('.react-flow__node').first().evaluate((el) => getComputedStyle(el).opacity);
    expect(Number(nodeOpacity)).toBeLessThan(0.5);
    await page.mouse.move(5, 5);
    await expect(page.getByTestId('legend-dim')).toHaveCount(0);

    // Collapsed, and still collapsed after a reload.
    await legend.getByTestId('legend-toggle').click();
    await expect(legend.getByTestId('legend-entry')).toHaveCount(0);
    await gotoWithProject(page);
    await expect(page.getByTestId('legend-graph').getByTestId('legend-toggle')).toHaveAttribute('aria-expanded', 'false');
    await page.getByTestId('legend-graph').getByTestId('legend-toggle').click();
    await expect(page.getByTestId('legend-graph').getByTestId('legend-entry').first()).toBeVisible();
  });
});
