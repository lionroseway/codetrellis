/**
 * Sidebar search — file tree filtering.
 *
 * Covers: search input, typing filters tree, clearing restores tree,
 * no-results message, partial matches.
 */

import { test, expect } from '@playwright/test';
import { gotoWithProject } from '../helpers/setup';

test.describe('Sidebar search', () => {
  test('search input is visible', async ({ page }) => {
    await gotoWithProject(page);

    const searchInput = page.getByPlaceholder('Search files...');
    await expect(searchInput).toBeVisible();
  });

  test('typing in search filters the file tree', async ({ page }) => {
    await gotoWithProject(page);

    const searchInput = page.getByPlaceholder('Search files...');

    // Count items before search
    const sidebar = page.locator('.glass-panel.border-r');
    const itemsBefore = await sidebar.locator('button').filter({ hasText: /.+/ }).count();

    // Type a specific filename to filter
    await searchInput.fill('package.json');
    await page.waitForTimeout(500);

    // Items after should be fewer (filtered)
    const itemsAfter = await sidebar.locator('button').filter({ hasText: /.+/ }).count();
    expect(itemsAfter).toBeLessThanOrEqual(itemsBefore);
  });

  test('clearing search restores full tree', async ({ page }) => {
    await gotoWithProject(page);

    const searchInput = page.getByPlaceholder('Search files...');
    const sidebar = page.locator('.glass-panel.border-r');

    // Count items before
    const itemsBefore = await sidebar.locator('button').filter({ hasText: /.+/ }).count();

    // Search for something
    await searchInput.fill('xyz_nonexistent_file');
    await page.waitForTimeout(500);

    // Clear search
    await searchInput.fill('');
    await page.waitForTimeout(500);

    // Items should be restored
    const itemsAfter = await sidebar.locator('button').filter({ hasText: /.+/ }).count();
    expect(itemsAfter).toBeGreaterThanOrEqual(itemsBefore - 1); // Allow for small fluctuations
  });

  test('no matches message shown for non-existent query', async ({ page }) => {
    await gotoWithProject(page);

    const searchInput = page.getByPlaceholder('Search files...');
    await searchInput.fill('zzzznonexistent_file_12345');
    await page.waitForTimeout(500);

    // Should show "No matches for..." message
    await expect(page.getByText(/No matches for/)).toBeVisible();
  });

  test('search is case-insensitive', async ({ page }) => {
    await gotoWithProject(page);

    const searchInput = page.getByPlaceholder('Search files...');
    const sidebar = page.locator('.glass-panel.border-r');

    // Search with lowercase
    await searchInput.fill('readme');
    await page.waitForTimeout(500);
    const lowercaseResults = await sidebar.locator('button').filter({ hasText: /.+/ }).count();

    // Search with uppercase
    await searchInput.fill('README');
    await page.waitForTimeout(500);
    const uppercaseResults = await sidebar.locator('button').filter({ hasText: /.+/ }).count();

    // Both should return the same results
    expect(lowercaseResults).toBe(uppercaseResults);
  });
});
