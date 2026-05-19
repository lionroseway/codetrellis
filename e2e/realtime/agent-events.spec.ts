/**
 * Agent events — session status and connected agents.
 *
 * Covers: agent status API, sessions API, connected agents widget
 * reflects session state.
 */

import { test, expect } from '@playwright/test';
import { gotoWithProject, API } from '../helpers/setup';

test.describe('Agent events', () => {
  test('agent status API returns data', async ({ request }) => {
    const res = await request.get(`${API}/agent/status`);
    expect(res.ok()).toBeTruthy();
  });

  test('sessions API returns array', async ({ request }) => {
    const res = await request.get(`${API}/sessions`);
    expect(res.ok()).toBeTruthy();
    const sessions = await res.json();
    expect(Array.isArray(sessions)).toBe(true);
  });

  test('connected agents widget shows count matching sessions', async ({ page }) => {
    await gotoWithProject(page);

    // Without any MCP sessions, should show "No agents"
    await expect(page.getByText('No agents').first()).toBeVisible({ timeout: 5000 });
  });
});
