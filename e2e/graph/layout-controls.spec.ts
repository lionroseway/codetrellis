/**
 * Layout controls — Map/Tree toggle, scope picker, auto-refresh, export.
 *
 * Covers: Map/Tree buttons and switching, scope filter dropdown,
 * auto-refresh toggle and interval selector, export button, Check now.
 */

import { test, expect } from '@playwright/test';
import { gotoWithProject } from '../helpers/setup';

test.describe('Layout controls', () => {
  test('Map and Tree layout buttons are visible', async ({ page }) => {
    await gotoWithProject(page);

    await expect(page.locator('button[title="Map view (force-directed)"]')).toBeVisible();
    await expect(page.locator('button[title="Tree view (hierarchical)"]')).toBeVisible();
  });

  // Each check waits for the switch and then for the graph. It used to count
  // nodes once after a fixed sleep, and the suite shares one project: a spec
  // on the other worker that rescans it empties every open graph until the
  // scan lands, so a single sample could read 0 (red in CI twice on
  // 2026-09-28, on PRs that touched no graph code).
  const tree = 'button[title="Tree view (hierarchical)"]';
  const map = 'button[title="Map view (force-directed)"]';
  const hasNodes = (page: import('@playwright/test').Page) =>
    expect.poll(() => page.locator('.react-flow__node').count(), { timeout: 20_000 }).toBeGreaterThan(0);

  test('clicking Tree switches to hierarchical layout', async ({ page }) => {
    await gotoWithProject(page);

    await page.locator(tree).click();
    await expect(page.locator(tree)).toHaveAttribute('aria-pressed', 'true');
    // Graph should still have nodes
    await hasNodes(page);
  });

  test('clicking Map switches to force-directed layout', async ({ page }) => {
    await gotoWithProject(page);

    // Switch to Tree first, then back to Map
    await page.locator(tree).click();
    await expect(page.locator(tree)).toHaveAttribute('aria-pressed', 'true');
    await page.locator(map).click();
    await expect(page.locator(map)).toHaveAttribute('aria-pressed', 'true');
    await expect(page.locator(tree)).toHaveAttribute('aria-pressed', 'false');

    await hasNodes(page);
  });

  test('scope filter dropdown is visible', async ({ page }) => {
    await gotoWithProject(page);

    // The scope filter container has a title attribute
    const scopeContainer = page.locator(
      '[title="Filter the graph to a single system / directory"]',
    );
    await expect(scopeContainer).toBeVisible();
  });

  test('scope filter has "All systems" default', async ({ page }) => {
    await gotoWithProject(page);

    const scopeSelect = page.locator(
      '[title="Filter the graph to a single system / directory"] select',
    );
    await expect(scopeSelect).toBeVisible();
    // Default value should be "All systems"
    await expect(scopeSelect.locator('option').first()).toHaveText('All systems');
  });

  test('Auto-refresh toggle is visible and defaults to Auto', async ({ page }) => {
    await gotoWithProject(page);

    const autoBtn = page.locator(
      'button[title="Pause automatic refresh checks"]',
    );
    await expect(autoBtn).toBeVisible();
    await expect(autoBtn).toContainText('Auto');
  });

  test('clicking Auto pauses refresh', async ({ page }) => {
    await gotoWithProject(page);

    // Click to pause
    await page
      .locator('button[title="Pause automatic refresh checks"]')
      .click();
    await page.waitForTimeout(300);

    // Should now show "Paused" with resume title
    const resumeBtn = page.locator(
      'button[title="Resume automatic refresh checks"]',
    );
    await expect(resumeBtn).toBeVisible();
    await expect(resumeBtn).toContainText('Paused');
  });

  test('Check now button is visible', async ({ page }) => {
    await gotoWithProject(page);

    await expect(
      page.locator('button[title="Check for changes now"]'),
    ).toBeVisible();
  });

  test('refresh interval selector has 5s/10s/30s options', async ({ page }) => {
    await gotoWithProject(page);

    const intervalSelect = page.locator(
      'select[title="Automatic refresh interval"]',
    );
    await expect(intervalSelect).toBeVisible();

    await expect(intervalSelect.locator('option').filter({ hasText: '5s' })).toBeAttached();
    await expect(intervalSelect.locator('option').filter({ hasText: '10s' })).toBeAttached();
    await expect(intervalSelect.locator('option').filter({ hasText: '30s' })).toBeAttached();
  });
});
