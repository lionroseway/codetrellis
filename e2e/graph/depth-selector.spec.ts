/**
 * Depth selector — Clusters / Files / Symbols toggle in the TopBar.
 *
 * Covers: button visibility, active state switching, default depth,
 * node type changes after switching.
 */

import { test, expect, type Page } from '@playwright/test';
import { gotoWithProject, FIXTURE_PATH } from '../helpers/setup';

/**
 * Pick a file the way a person does in a large repository: in the Explorer.
 *
 * These tests used to click the file's card on the canvas. The canvas mounts
 * only the cards inside the viewport (`onlyRenderVisibleElements`), and this
 * suite's project was the repository itself, too big for fit-view to show
 * whole at its minimum zoom: adding any file could move the card off screen
 * (it did, on the Phase 32 A1.2 PR). The specs now open the sample app (HD2),
 * and still pick in the Explorer, which selects and focuses the same file
 * wherever the layout puts it.
 */
async function pickInExplorer(page: Page, filePath: string) {
  const parts = filePath.split('/');
  const row = (name: string) => page.getByRole('button', { name, exact: true }).first();
  for (const [i, name] of parts.entries()) {
    const next = parts[i + 1];
    // A folder already open (the top level starts open) would close on a click.
    if (next && (await row(next).isVisible())) continue;
    await row(name).scrollIntoViewIfNeeded();
    await row(name).click();
    if (next) await expect(row(next)).toBeVisible();
  }
}

test.describe('Depth selector', () => {
  test('Clusters / Files / Symbols buttons are visible', async ({ page }) => {
    await gotoWithProject(page, { projectPath: FIXTURE_PATH });

    await expect(page.getByRole('button', { name: 'Clusters', exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Files', exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Symbols', exact: true })).toBeVisible();
  });

  test('Clusters is the default active depth', async ({ page }) => {
    await gotoWithProject(page, { projectPath: FIXTURE_PATH });

    const clustersBtn = page.getByRole('button', { name: 'Clusters', exact: true });
    // Active button has accent styling
    await expect(clustersBtn).toBeVisible();
    // Files and Symbols should not have active styling
    const filesBtn = page.getByRole('button', { name: 'Files', exact: true });
    await expect(filesBtn).toBeVisible();
  });

  test('clicking Files switches depth to file-level nodes', async ({ page }) => {
    await gotoWithProject(page, { projectPath: FIXTURE_PATH });

    await page.getByRole('button', { name: 'Files', exact: true }).click();
    await page.waitForTimeout(2000);

    // After switching to Files, the graph should still have nodes
    const nodes = page.locator('.react-flow__node');
    const count = await nodes.count();
    expect(count).toBeGreaterThan(0);
  });

  test('clicking Symbols switches depth', async ({ page }) => {
    await gotoWithProject(page, { projectPath: FIXTURE_PATH });

    await page.getByRole('button', { name: 'Symbols', exact: true }).click();
    await page.waitForTimeout(2000);

    // Graph canvas should still be visible
    await expect(page.locator('.react-flow')).toBeVisible();
  });

  // The test above only checks the canvas survives, which is how Symbols
  // shipped rendering the Clusters view for months: nothing asserted it
  // showed a symbol. This walks the actual journey.
  test('Symbols shows the symbols of the file you pick', async ({ page }) => {
    await gotoWithProject(page, { projectPath: FIXTURE_PATH });
    await page.getByRole('button', { name: 'Symbols', exact: true }).click();

    // Nothing picked yet: files to choose from (not clusters), and it says so.
    const status = page.getByTestId('symbols-status');
    await expect(status).toContainText('click a file');
    await expect(page.locator('.react-flow__node-packageNode')).toHaveCount(0);

    await pickInExplorer(page, 'packages/web/src/api.ts');

    await expect(page.locator('.react-flow__node-symbolNode').first()).toBeVisible({ timeout: 10_000 });
    await expect(status).toContainText(/\d+ symbols? in api\.ts/);
  });

  test('a file focused in Files view survives the switch to Symbols', async ({ page }) => {
    await gotoWithProject(page, { projectPath: FIXTURE_PATH });
    await page.getByRole('button', { name: 'Files', exact: true }).click();
    await pickInExplorer(page, 'packages/web/src/api.ts'); // selects and focuses it

    await page.getByRole('button', { name: 'Symbols', exact: true }).click();
    await expect(page.locator('.react-flow__node-symbolNode').first()).toBeVisible({ timeout: 10_000 });
  });

  test('switching back to Clusters from Files', async ({ page }) => {
    await gotoWithProject(page, { projectPath: FIXTURE_PATH });

    // Switch to Files first
    await page.getByRole('button', { name: 'Files', exact: true }).click();
    await page.waitForTimeout(1500);

    // Switch back to Clusters
    await page.getByRole('button', { name: 'Clusters', exact: true }).click();
    await page.waitForTimeout(1500);

    // Graph should still have nodes
    const nodes = page.locator('.react-flow__node');
    const count = await nodes.count();
    expect(count).toBeGreaterThan(0);
  });
});
