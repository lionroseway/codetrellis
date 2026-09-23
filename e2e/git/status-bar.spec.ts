/**
 * Status bar — scan status, project path, event count, agent status.
 *
 * Covers: "Ready" status after scan, project path display, Terminal button,
 * MCP config button, git status API, health endpoint.
 */

import { test, expect } from '@playwright/test';
import { gotoWithProject, API, PROJECT_PATH } from '../helpers/setup';

test.describe('Status bar', () => {
  test('shows "Ready" after project scan', async ({ page }) => {
    await gotoWithProject(page);

    await expect(page.getByText('Ready').first()).toBeVisible({ timeout: 5000 });
  });

  test('shows project path in monospace', async ({ page }) => {
    await gotoWithProject(page);

    // The path should contain "codetrellis" since that's our project
    const pathEl = page.locator('span.font-mono').filter({ hasText: /codetrellis/ }).first();
    await expect(pathEl).toBeVisible({ timeout: 5000 });
  });

  test('Terminal button visible in status bar', async ({ page }) => {
    await gotoWithProject(page);

    await expect(page.getByText('Terminal').first()).toBeVisible({ timeout: 5000 });
  });

  test('MCP config copy button visible', async ({ page }) => {
    await gotoWithProject(page);

    await expect(page.locator('button[title="Copy MCP config"]')).toBeVisible({ timeout: 5000 });
  });

  test('shows Connected or Watching status', async ({ page }) => {
    await gotoWithProject(page);

    // Agent status shows either "Connected" or "Watching"
    const connected = page.getByText('Connected').first();
    const watching = page.getByText('Watching').first();
    const either = connected.or(watching);
    // Both can be on screen at once; either answers the question.
    await expect(either.first()).toBeVisible({ timeout: 5000 });
  });

  test('git status API returns file changes', async ({ request }) => {
    const res = await request.get(
      `${API}/git/status?path=${encodeURIComponent(PROJECT_PATH)}`,
    );
    expect(res.ok()).toBeTruthy();
    const status = await res.json();
    expect(Array.isArray(status.staged)).toBe(true);
    expect(Array.isArray(status.unstaged)).toBe(true);
    expect(Array.isArray(status.untracked)).toBe(true);
  });

  test('health endpoint returns ok', async ({ request }) => {
    const res = await request.get(`${API}/health`);
    expect(res.ok()).toBeTruthy();
    const body = await res.json();
    expect(body.status).toBe('ok');
  });
});
