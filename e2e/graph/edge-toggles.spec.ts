/**
 * Phase 33 G3 — import edges can be turned off, and the graph remembers.
 *
 * The owner: "graph being able to toggle on or off imports". Beside
 * Overlays, an Edges menu turns off imports, cross-system links and symbol
 * links each on its own; the choice is kept per machine, like overlays.
 * Cross-system edges have `xs:` ids, so everything else drawn here is an
 * import or a symbol link.
 */

import { test, expect, type Page } from '@playwright/test';
import { gotoWithProject } from '../helpers/setup';

const importEdges = (page: Page) => page.locator('.react-flow__edge:not([data-id^="xs:"])');

test.describe('Graph edge toggles', () => {
  test('turning imports off removes them from the graph, and it stays off after a reload', async ({ page }) => {
    await gotoWithProject(page);
    await expect.poll(() => importEdges(page).count(), { timeout: 15_000 }).toBeGreaterThan(0);

    const button = page.getByTestId('graph-edges');
    await expect(button).toContainText('3/3');
    await button.click();
    const menu = page.getByTestId('graph-edges-menu');
    await expect(menu.locator('label')).toHaveText([/Imports/, /Cross-system/, /Symbol links/]);
    await menu.getByTestId('edges-imports').uncheck();
    await expect(importEdges(page)).toHaveCount(0);
    await expect(button).toContainText('2/3');
    // The nodes stay; only the lines go.
    await expect.poll(() => page.locator('.react-flow__node').count()).toBeGreaterThan(0);

    await gotoWithProject(page);
    await expect.poll(() => page.locator('.react-flow__node').count(), { timeout: 15_000 }).toBeGreaterThan(0);
    await expect(page.getByTestId('graph-edges')).toContainText('2/3');
    await expect(importEdges(page)).toHaveCount(0);

    await page.getByTestId('graph-edges').click();
    await page.getByTestId('edges-imports').check();
    await expect.poll(() => importEdges(page).count(), { timeout: 15_000 }).toBeGreaterThan(0);
    await expect(page.getByTestId('graph-edges')).toContainText('3/3');
  });
});
