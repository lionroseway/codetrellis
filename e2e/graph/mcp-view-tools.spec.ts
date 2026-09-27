/**
 * The graph view tools, driven over MCP against a real page (Phase 32 §0.4b).
 *
 * These tools only broadcast; the renderer does the work. The harness
 * test (tests/e2e/graph-tools.test.ts) proves the broadcasts. This proves
 * the canvas obeys them — which is where `graph_set_mode('baseline')`
 * failed: it sent a mode the renderer does not have, so nothing changed.
 *
 * Serial (playwright.config SERIAL_SPECS): the tools reach every open page.
 */

import { test, expect, type Page } from '@playwright/test';
import { gotoWithProject } from '../helpers/setup';
import { createMcpClient } from '../helpers/mcp-client';
import { FIXTURE_PATH } from '../live-agent/helpers/fixture-reset';

type Client = Awaited<ReturnType<typeof createMcpClient>>;

function text(result: any): string {
  return (result?.content ?? []).filter((c: any) => c.type === 'text').map((c: any) => c.text).join('\n');
}

async function pressed(page: Page, name: string | RegExp): Promise<string | null> {
  return page.getByRole('button', { name, exact: typeof name === 'string' }).first().getAttribute('aria-pressed');
}

test.describe('Graph view tools against the canvas', () => {
  let client: Client;

  test.beforeEach(async () => {
    client = await createMcpClient();
  });
  test.afterEach(() => client?.close());

  test('mode, layout and depth follow the tools', async ({ page }) => {
    await gotoWithProject(page, { projectPath: FIXTURE_PATH });

    await client.callTool('graph_set_mode', { mode: 'baseline' });
    await expect.poll(() => pressed(page, 'Baseline')).toBe('true');
    expect(await pressed(page, 'Live')).toBe('false');

    await client.callTool('graph_set_mode', { mode: 'planned' });
    await expect.poll(() => pressed(page, 'Planned')).toBe('true');
    await client.callTool('graph_set_mode', { mode: 'live' });
    await expect.poll(() => pressed(page, 'Live')).toBe('true');

    await client.callTool('graph_set_layout', { layout: 'tree' });
    await expect.poll(() => pressed(page, /^Tree$/)).toBe('true');
    await client.callTool('graph_set_layout', { layout: 'map' });
    await expect.poll(() => pressed(page, /^Map$/)).toBe('true');

    await client.callTool('graph_set_depth', { depth: 'file' });
    await expect.poll(() => pressed(page, 'Files')).toBe('true');
    await client.callTool('graph_set_depth', { depth: 'package' });
    await expect.poll(() => pressed(page, 'Clusters')).toBe('true');
  });

  test('ui_ready and graph_snapshot answer from the live window', async ({ page }) => {
    await gotoWithProject(page, { projectPath: FIXTURE_PATH });

    const ready = JSON.parse(text(await client.callTool('ui_ready', {})));
    expect(ready.ready, JSON.stringify(ready)).toBe(true);

    await client.callTool('graph_set_depth', { depth: 'file' });
    await expect.poll(() => pressed(page, 'Files')).toBe('true');

    const compact = JSON.parse(text(await client.callTool('graph_snapshot', {})));
    expect(compact.nodeCount).toBeGreaterThan(0);
    expect(compact.nodes.length).toBe(compact.nodeCount);
    expect(compact.nodes.every((n: any) => !('metadata' in n))).toBe(true);

    const full = JSON.parse(text(await client.callTool('graph_snapshot', { include_metadata: true })));
    expect(full.nodes.some((n: any) => 'metadata' in n)).toBe(true);
  });

  test('graph_select selects file nodes by their project-relative path', async ({ page }) => {
    await gotoWithProject(page, { projectPath: FIXTURE_PATH });
    await client.callTool('graph_set_depth', { depth: 'file' });
    await expect.poll(() => pressed(page, 'Files')).toBe('true');

    const paths = ['packages/web/src/UserList.tsx', 'packages/web/src/api.ts'];
    await client.callTool('graph_select', { paths });
    // Two or more selected nodes bring up the multi-select bar.
    await expect(page.getByRole('button', { name: /Plan these/ })).toBeVisible({ timeout: 5000 });

    await client.callTool('graph_select', { paths: [] });
    await expect(page.getByRole('button', { name: /Plan these/ })).toHaveCount(0);
  });
});
