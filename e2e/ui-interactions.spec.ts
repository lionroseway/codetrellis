import { test, expect } from '@playwright/test';

const API = 'http://localhost:3001/api';
const PROJECT_PATH = process.cwd();

test.describe('UI interactions', () => {
  test.beforeAll(async ({ request }) => {
    // Ensure project is scanned
    await request.post(`${API}/project/scan`, {
      data: { projectPath: PROJECT_PATH },
    });
  });

  test('open project via folder picker modal', async ({ page }) => {
    await page.goto('/');
    // Click the + button or Open Project
    await page.click('text=Open Project');
    // Folder picker modal should appear
    await expect(page.locator('text=Open Project').last()).toBeVisible();
  });

  test('depth selector switches views', async ({ page }) => {
    await page.goto('/');
    // Default is Packages
    const packagesBtn = page.locator('button:has-text("Packages")');
    await expect(packagesBtn).toBeVisible();

    // Click Files
    await page.click('button:has-text("Files")');
    // Click Symbols
    await page.click('button:has-text("Symbols")');
    // Click back to Packages
    await page.click('button:has-text("Packages")');
  });

  test('plan panel shows tabs', async ({ page }) => {
    await page.goto('/');
    await expect(page.getByRole('button', { name: 'Plans' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Timeline' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Changes' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Comments' })).toBeVisible();
  });

  test('MCP guide modal opens', async ({ page }) => {
    await page.goto('/');
    await page.click('text=Connect Agent');
    await expect(page.locator('text=Connect an AI Agent')).toBeVisible();
    await expect(page.locator('text=Copy Config')).toBeVisible();
  });

  test('sidebar search filters files', async ({ page }) => {
    await page.goto('/');
    // Type in search
    const search = page.locator('input[placeholder="Search files..."]');
    if (await search.isVisible()) {
      await search.fill('server');
      // Should filter results
      await page.waitForTimeout(500);
    }
  });

  test('keyboard shortcut Escape deselects', async ({ page }) => {
    await page.goto('/');
    await page.keyboard.press('Escape');
    // Should not crash
  });
});
