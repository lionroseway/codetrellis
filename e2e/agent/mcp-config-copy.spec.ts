/**
 * MCP config copy — StatusBar copy button and config endpoint.
 *
 * Covers: MCP port badge in status bar, copy button, config API endpoint.
 */

import { test, expect } from '@playwright/test';
import { gotoWithProject, API } from '../helpers/setup';

test.describe('MCP config copy', () => {
  test('StatusBar shows MCP port badge', async ({ page }) => {
    await gotoWithProject(page);

    // StatusBar has "MCP :19432" button
    await expect(page.locator('button[title="Copy MCP config"]')).toBeVisible({ timeout: 5000 });
  });

  test('MCP config endpoint returns valid JSON', async ({ request }) => {
    const res = await request.get(`${API}/mcp/config`);
    expect(res.ok()).toBeTruthy();
    const config = await res.json();
    expect(config).toBeTruthy();
    // Config should have the codetrellis server entry
    expect(JSON.stringify(config)).toContain('codetrellis');
  });

  test('MCP status endpoint returns port info', async ({ request }) => {
    const res = await request.get(`${API}/mcp/status`);
    expect(res.ok()).toBeTruthy();
    const status = await res.json();
    expect(status.port).toBeTruthy();
  });
});
