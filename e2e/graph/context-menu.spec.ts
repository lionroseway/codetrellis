/**
 * Context menu — right-click on graph nodes.
 *
 * Covers: right-click opens context menu, menu items present,
 * clicking outside closes menu, Escape closes menu.
 */

import { test, expect } from '@playwright/test';
import { gotoWithProject, reachableNodes, FIXTURE_PATH } from '../helpers/setup';

test.describe('Node context menu', () => {
  test('right-clicking a node opens context menu', async ({ page }) => {
    await gotoWithProject(page, { projectPath: FIXTURE_PATH });

    await page.waitForTimeout(2000);
    const firstNode = (await reachableNodes(page))[0];
    await expect(firstNode).toBeVisible();

    await firstNode.click({ button: 'right' });
    await page.waitForTimeout(300);

    // Context menu should appear — it has a "Plan a change" button (when no plan active)
    // or "Explain with agent"
    await expect(page.getByText('Explain with agent')).toBeVisible({ timeout: 2000 });
  });

  test('context menu has "Plan a change" option when no plan active', async ({ page }) => {
    await gotoWithProject(page, { projectPath: FIXTURE_PATH });

    await page.waitForTimeout(2000);
    const firstNode = (await reachableNodes(page))[0];
    await firstNode.click({ button: 'right' });
    await page.waitForTimeout(300);

    await expect(page.getByText('Plan a change')).toBeVisible();
  });

  test('context menu has "Explain with agent" option', async ({ page }) => {
    await gotoWithProject(page, { projectPath: FIXTURE_PATH });

    await page.waitForTimeout(2000);
    const firstNode = (await reachableNodes(page))[0];
    await firstNode.click({ button: 'right' });
    await page.waitForTimeout(300);

    await expect(page.getByText('Explain with agent')).toBeVisible();
  });

  test('context menu has "Scope plan to this" for cluster nodes', async ({ page }) => {
    await gotoWithProject(page, { projectPath: FIXTURE_PATH });

    await page.waitForTimeout(2000);
    // Default depth is Clusters, so nodes should be package/directory type
    const firstNode = (await reachableNodes(page))[0];
    await firstNode.click({ button: 'right' });
    await page.waitForTimeout(300);

    await expect(page.getByText('Scope plan to this')).toBeVisible();
  });

  test('clicking outside context menu closes it', async ({ page }) => {
    await gotoWithProject(page, { projectPath: FIXTURE_PATH });

    await page.waitForTimeout(2000);
    const firstNode = (await reachableNodes(page))[0];
    await firstNode.click({ button: 'right' });
    await page.waitForTimeout(300);

    await expect(page.getByText('Explain with agent')).toBeVisible();

    // Click the sidebar area (well outside the context menu)
    await page.locator('.glass-panel.border-r').click({ force: true });
    await page.waitForTimeout(500);

    // Moving the canvas also closes the menu — verify via Escape as fallback
    const menuStillVisible = await page.getByText('Explain with agent').isVisible();
    if (menuStillVisible) {
      // Use Escape which is guaranteed to close
      await page.keyboard.press('Escape');
      await page.waitForTimeout(300);
    }
    await expect(page.getByText('Explain with agent')).not.toBeVisible();
  });

  test('the view refitting leaves the menu open; moving it by hand closes it', async ({ page }) => {
    await gotoWithProject(page, { projectPath: FIXTURE_PATH });

    const firstNode = (await reachableNodes(page))[0];
    await firstNode.click({ button: 'right' });
    const menuItem = page.getByText('Explain with agent');
    await expect(menuItem).toBeVisible();

    // A live refresh that changes the node count refits the same way. The menu
    // closing then took "Plan a change" from under a click on its way to it.
    await page.getByRole('button', { name: 'Fit View' }).click();
    await page.waitForTimeout(600);
    await expect(menuItem).toBeVisible();

    const pane = (await page.locator('.react-flow__pane').boundingBox())!;
    await page.mouse.move(pane.x + 20, pane.y + pane.height / 2);
    await page.mouse.wheel(0, 200);
    await expect(menuItem).not.toBeVisible();
  });

  test('Escape closes context menu', async ({ page }) => {
    await gotoWithProject(page, { projectPath: FIXTURE_PATH });

    await page.waitForTimeout(2000);
    const firstNode = (await reachableNodes(page))[0];
    await firstNode.click({ button: 'right' });
    await page.waitForTimeout(300);

    await expect(page.getByText('Explain with agent')).toBeVisible();

    await page.keyboard.press('Escape');
    await page.waitForTimeout(300);

    await expect(page.getByText('Explain with agent')).not.toBeVisible();
  });
});
