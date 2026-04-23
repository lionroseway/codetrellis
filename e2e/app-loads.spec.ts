import { test, expect } from '@playwright/test';

test.describe('App loading', () => {
  test('renders the welcome screen when no project is open', async ({ page }) => {
    await page.goto('/');
    await expect(page.getByRole('heading', { name: 'CodeTrellis' })).toBeVisible();
    // The welcome screen CTA button
    await expect(page.locator('button:has-text("Open Project") >> nth=0')).toBeVisible();
  });

  test('shows the top bar with depth selector', async ({ page }) => {
    await page.goto('/');
    await expect(page.getByRole('button', { name: 'Clusters' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Files' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Symbols' })).toBeVisible();
  });

  test('shows the sidebar with explorer header', async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('text=Explorer')).toBeVisible();
  });

  test('shows Connect Agent button', async ({ page }) => {
    await page.goto('/');
    await expect(page.getByRole('button', { name: /Connect Agent/ })).toBeVisible();
  });
});
