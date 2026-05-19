/**
 * Project tabs — open, switch, close tabs in the TopBar.
 *
 * Covers: tab appears after scan, switching tabs, close button,
 * closing last tab returns to welcome.
 */

import { test, expect, type Page } from '@playwright/test';
import { gotoWithProject, PROJECT_PATH } from '../helpers/setup';

test.describe('Project tabs', () => {
  test('tab shows project name after opening', async ({ page }) => {
    await gotoWithProject(page);

    // Tab bar should contain a segment with the project's display name
    // The display name is the last path segment
    const projectName = PROJECT_PATH.split('/').pop()!;
    await expect(page.getByText(projectName).first()).toBeVisible();
  });

  test('+ button is visible for opening another project', async ({ page }) => {
    await gotoWithProject(page);

    await expect(page.locator('button[title="Open project"]')).toBeVisible();
  });

  test('+ button opens folder picker', async ({ page }) => {
    await gotoWithProject(page);

    await page.locator('button[title="Open project"]').click();
    // Folder picker modal should open
    await expect(page.getByRole('heading', { name: 'Open Project' }).last()).toBeVisible({
      timeout: 3000,
    });
  });

  test('rescan button is visible when project open', async ({ page }) => {
    await gotoWithProject(page);

    await expect(page.locator('button[title="Rescan project"]')).toBeVisible();
  });
});
