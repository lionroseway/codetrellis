/**
 * Settings MCP server — port input, autodetect toggle, config snippet.
 *
 * Covers: port input, autodetect checkbox, config snippet with Copy button.
 */

import { test, expect } from '@playwright/test';
import { gotoWithProject, API } from '../helpers/setup';

test.describe('Settings MCP server', () => {
  test('MCP Server section shows port input', async ({ page }) => {
    await gotoWithProject(page);

    await page.locator('button[title*="Settings"]').click();
    await page.waitForTimeout(500);
    await page.getByRole('button', { name: 'MCP Server' }).click();
    await page.waitForTimeout(300);

    // Port input should show 19432 or similar
    const portInput = page.locator('input[type="number"]');
    await expect(portInput).toBeVisible({ timeout: 3000 });
  });

  test('autodetect checkbox is visible', async ({ page }) => {
    await gotoWithProject(page);

    await page.locator('button[title*="Settings"]').click();
    await page.waitForTimeout(500);
    await page.getByRole('button', { name: 'MCP Server' }).click();
    await page.waitForTimeout(300);

    await expect(page.getByText('Autodetect on collision').first()).toBeVisible({ timeout: 3000 });
  });

  test('config snippet shows JSON with Copy button', async ({ page }) => {
    await gotoWithProject(page);

    await page.locator('button[title*="Settings"]').click();
    await page.waitForTimeout(500);
    await page.getByRole('button', { name: 'MCP Server' }).click();
    await page.waitForTimeout(300);

    // Config snippet in a pre block
    const preBlock = page.locator('pre');
    await expect(preBlock.first()).toBeVisible({ timeout: 3000 });

    // Copy button nearby
    await expect(page.locator('button:has-text("Copy")').first()).toBeVisible();
  });

  test('MCP status API returns port info', async ({ request }) => {
    const res = await request.get(`${API}/mcp/status`);
    expect(res.ok()).toBeTruthy();
    const status = await res.json();
    expect(status.port).toBeTruthy();
  });

  test('default port is 19432', async ({ page }) => {
    await gotoWithProject(page);

    await page.locator('button[title*="Settings"]').click();
    await page.waitForTimeout(500);
    await page.getByRole('button', { name: 'MCP Server' }).click();
    await page.waitForTimeout(300);

    await expect(page.getByText('19432').first()).toBeVisible({ timeout: 3000 });
  });
});

/**
 * Phase 31 §6.1 — "Add to Claude Desktop". The file work is main-process
 * only (unit-tested in claude-desktop-config.test.ts); here the page is
 * driven against a stand-in for that IPC, to prove the person sees the diff
 * before anything is written and that a stale preview is shown again.
 */
test.describe('Add to Claude Desktop', () => {
  const openMcp = async (page: import('@playwright/test').Page) => {
    await gotoWithProject(page);
    await page.locator('button[title*="Settings"]').click();
    await page.getByRole('button', { name: 'MCP Server' }).click();
  };

  test('is not offered outside the desktop app', async ({ page }) => {
    await openMcp(page);
    await expect(page.getByTestId('mcp-config-snippet')).toBeVisible({ timeout: 5000 });
    await expect(page.getByRole('button', { name: /Add to Claude Desktop/ })).toHaveCount(0);
  });

  test('shows the change first, writes only on Add, and re-shows a file that changed underneath', async ({ page }) => {
    await page.addInitScript(() => {
      const calls: string[] = [];
      let previews = 0;
      (window as unknown as { __cdCalls: string[] }).__cdCalls = calls;
      (window as unknown as { electronAPI: unknown }).electronAPI = {
        claudeDesktop: {
          preview: async () => {
            calls.push('preview');
            previews += 1;
            return {
              ok: true, status: 'add', exists: true, path: '/Users/me/Library/Application Support/Claude/claude_desktop_config.json',
              beforeHash: previews === 1 ? 'a'.repeat(64) : 'b'.repeat(64),
              diff: [{ op: ' ', text: '{' }, { op: '+', text: `  "codetrellis": { "command": "/Applications/CodeTrellis.app" }${previews > 1 ? ' ' : ''}` }, { op: ' ', text: '}' }],
            };
          },
          apply: async (hash: string) => {
            calls.push(`apply:${hash[0]}`);
            return hash === 'a'.repeat(64)
              ? { ok: false, changed: true, reason: "Claude Desktop's config changed after you looked at it. Here is the change again, against the file as it is now." }
              : { ok: true, status: 'add', path: '/x/claude_desktop_config.json', backupPath: '/x/claude_desktop_config.before-codetrellis-1.json' };
          },
        },
      };
    });
    await openMcp(page);
    const panel = page.getByTestId('add-to-claude-desktop');
    await panel.getByRole('button', { name: 'Add to Claude Desktop…' }).click();
    await expect(panel.getByText('claude_desktop_config.json', { exact: false }).first()).toBeVisible();
    await expect(panel.getByTestId('claude-desktop-diff')).toContainText('+   "codetrellis"');
    expect(await page.evaluate(() => (window as unknown as { __cdCalls: string[] }).__cdCalls)).toEqual(['preview']);

    // The file changed after the preview: nothing written, the new diff shown.
    await panel.getByRole('button', { name: 'Add to Claude Desktop', exact: true }).click();
    await expect(panel.getByText(/changed after you looked at it/)).toBeVisible();
    await panel.getByRole('button', { name: 'Add to Claude Desktop', exact: true }).click();
    await expect(panel.getByText(/Added\. Quit and reopen Claude Desktop/)).toBeVisible();
    await expect(panel.getByText(/before-codetrellis-1\.json/)).toBeVisible();
    expect(await page.evaluate(() => (window as unknown as { __cdCalls: string[] }).__cdCalls)).toEqual(['preview', 'apply:a', 'preview', 'apply:b']);
  });
});
