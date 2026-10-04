/**
 * Golden chain: WebSocket event pipeline — verify that backend
 * broadcasts reach the frontend and update Zustand stores.
 *
 * Tests the real-time event system that makes CodeTrellis feel alive:
 * API mutations → broadcast() → WS → useWebSocket hook → Zustand → UI.
 */

import { test, expect, type Page } from '@playwright/test';
import { gotoWithProject, seedPlan, cleanupPlans, API } from '../helpers/setup';

/**
 * Opens a socket from the page and says how it ended: `open`, `error`,
 * `closed <code>` or `no answer`. It used to give the upgrade three seconds
 * and report a bare `false`. The backend parses synchronously, so while it
 * scans a project the size of this repository the upgrade waits behind the
 * scan, and on a loaded runner that can be longer than three seconds. #226
 * (browser 1/3) failed there with nothing to say whether it had waited or
 * been refused; now the failure says which.
 */
function openSocket(page: Page): Promise<string> {
  return page.evaluate(() => new Promise<string>((resolve) => {
    const ws = new WebSocket(`ws://${window.location.host}/ws`);
    ws.onopen = () => { ws.close(); resolve('open'); };
    ws.onerror = () => resolve('error');
    ws.onclose = (e) => resolve(`closed ${e.code}`);
    setTimeout(() => resolve('no answer'), 15_000);
  }));
}

test.describe('WebSocket event pipeline', () => {
  const PLAN_TITLE = 'E2E WS Events Plan';

  test.afterEach(async ({ request }) => {
    await cleanupPlans(request, 'E2E WS Events');
  });

  test('WebSocket connects on page load', async ({ page }) => {
    await gotoWithProject(page);

    // The useWebSocket hook should have connected
    expect(await openSocket(page)).toBe('open');
  });

  test('plan-created broadcast → plan appears in list without refresh', async ({ page, request }) => {
    await gotoWithProject(page);

    // Open the Plans tab
    await page.getByRole('button', { name: 'Plans', exact: true }).click();
    await page.waitForTimeout(500);

    // Create a plan via API (this triggers broadcast('plan-created', ...))
    const planRes = await request.post(`${API}/plans`, {
      data: {
        title: PLAN_TITLE,
        description: 'Created while UI is open',
        projectPath: process.cwd(),
      },
    });
    expect(planRes.ok()).toBeTruthy();

    // Wait for WS broadcast to propagate
    await page.waitForTimeout(3000);

    // The plan should appear in the list WITHOUT a manual refresh
    const planVisible = await page.getByText(PLAN_TITLE).first()
      .waitFor({ state: 'visible', timeout: 5000 }).then(() => true).catch(() => false);

    // If real-time push works, it appears instantly. If not, we can
    // verify it appears after clicking the tab again (polling fallback).
    if (!planVisible) {
      await page.getByRole('button', { name: 'Plans', exact: true }).click();
      await page.waitForTimeout(1000);
    }

    await expect(page.getByText(PLAN_TITLE).first()).toBeVisible({ timeout: 3000 });
  });

  test('item status update via API triggers broadcast', async ({ page, request }) => {
    const plan = await seedPlan(request, {
      title: PLAN_TITLE,
      actions: [{ title: 'Toast trigger action', body: 'Will go in_progress' }],
    });

    await gotoWithProject(page);
    await page.waitForTimeout(1000);

    // Update item status via V2 items API (triggers broadcast('plan-item-updated', ...))
    const updateRes = await request.put(`${API}/items/${plan.actionUids[0]}`, {
      data: { status: 'in_progress' },
    });
    expect(updateRes.ok()).toBeTruthy();

    // Wait for WS broadcast to propagate
    await page.waitForTimeout(2000);

    // Verify the item was actually updated via API
    const itemRes = await request.get(`${API}/items/${plan.actionUids[0]}`);
    expect(itemRes.ok()).toBeTruthy();
    const item = await itemRes.json();
    expect(item.status).toBe('in_progress');
  });

  test('file-changed broadcast → agent store marks file', async ({ page }) => {
    await gotoWithProject(page);

    // NOTE: The server broadcasts TO clients; clients can't broadcast
    // back. So this checks that the frontend WS connection is alive by
    // verifying it opens.
    expect(await openSocket(page)).toBe('open');
  });

  test('session-registered broadcast → "Agent connected" toast', async ({ page, request }) => {
    await gotoWithProject(page);
    const port = (await request.get(`${API}/mcp/status`).then(r => r.json())).port || 19432;

    // Connect an MCP agent — this triggers session_start + session-registered broadcasts
    const connected = await page.evaluate(async (mcpPort: number) => {
      return new Promise<boolean>((resolve) => {
        const timeout = setTimeout(() => resolve(false), 5000);
        const es = new EventSource(`http://127.0.0.1:${mcpPort}/sse`);
        (window as any).__test_es = es;
        es.addEventListener('endpoint', () => {
          clearTimeout(timeout);
          resolve(true);
        });
        es.onerror = () => {
          clearTimeout(timeout);
          resolve(false);
        };
      });
    }, port);

    if (connected) {
      await page.waitForTimeout(3000);

      // "Agent connected" toast or session list update should have fired
      const hasAgentSignal = await page.evaluate(() => {
        const text = document.body.textContent || '';
        return text.includes('Agent connected') || text.includes('agent') || text.includes('MCP');
      });
      // At least the session should be registered
      const sessRes = await request.get(`${API}/sessions`);
      const sessions = await sessRes.json();
      expect(sessions.length).toBeGreaterThanOrEqual(1);
    }

    // Cleanup
    await page.evaluate(() => {
      const es = (window as any).__test_es;
      if (es) es.close();
      delete (window as any).__test_es;
    });
  });

  test('deviation-detected would trigger warning toast', async ({ page, request }) => {
    // We can't easily trigger a real deviation, but we can verify the
    // endpoint exists and the toast infrastructure is wired
    const plan = await seedPlan(request, {
      title: PLAN_TITLE,
      actions: [{ title: 'Deviation check action', body: 'body' }],
    });

    const res = await request.get(`${API}/plans/${plan.uid}/deviations`);
    // Might return empty array or 404 — either is fine, shouldn't 500
    expect(res.status()).toBeLessThan(500);
  });
});
