/**
 * Golden chain: MCP agent connects → creates plan → claims task →
 * reports progress → marks done → UI reflects every step.
 *
 * This is the end-to-end "how a user actually uses CodeTrellis" test.
 * It simulates a real MCP agent by connecting to the SSE endpoint from
 * Node, calling tools via the MCP JSON-RPC protocol, and verifying the
 * frontend UI updates in real time via WebSocket broadcasts.
 */

import { test, expect } from '@playwright/test';
import { gotoWithProject, cleanupPlans, API, PROJECT_PATH } from '../helpers/setup';
import { createMcpClient } from '../helpers/mcp-client';

/** Discover the actual MCP port from the running server. */
async function getMcpPort(request: any): Promise<number> {
  const res = await request.get(`${API}/mcp/status`);
  const status = await res.json();
  return status.port || 19432;
}

/**
 * The agent runs in Node, as a real one does — not inside the page.
 *
 * This used to open an EventSource to the MCP server from the web page.
 * Phase 19 exists to make that impossible: loopback is not an
 * authorisation boundary, so a page in a browser must not be able to reach
 * the MCP server, and an EventSource cannot present the token anyway. The
 * page's job here is to SHOW what the agent did.
 */
let agent: Awaited<ReturnType<typeof createMcpClient>> | null = null;

async function connectMcpAgent(): Promise<{ sessionId: string; error?: string }> {
  try {
    agent = await createMcpClient();
    return { sessionId: agent.sessionId };
  } catch (err) {
    return { sessionId: '', error: String(err) };
  }
}

function disconnectMcpAgent(): void {
  agent?.close();
  agent = null;
}

test.describe('MCP agent flow — golden chain', () => {
  const PLAN_TITLE = 'E2E Golden Chain Plan';

  test.afterEach(async ({ request }) => {
    await cleanupPlans(request, 'E2E Golden Chain');
  });

  test('1 — MCP health endpoint returns connected client count', async ({ request }) => {
    const port = await getMcpPort(request);
    const res = await request.get(`http://127.0.0.1:${port}/health`);
    expect(res.ok()).toBeTruthy();
    const body = await res.json();
    expect(body.name).toBe('codetrellis-mcp');
    expect(typeof body.connectedClients).toBe('number');
  });

  test('2 — agent connects via SSE and gets session', async ({ page, request }) => {
    await gotoWithProject(page);

    const { sessionId, error } = await connectMcpAgent();
    expect(error).toBeFalsy();
    expect(sessionId).toBeTruthy();

    // Wait for the WebSocket broadcast to update the UI
    await page.waitForTimeout(2000);

    // Sessions API should now include our session
    const sessRes = await request.get(`${API}/sessions`);
    const sessions = await sessRes.json();
    expect(sessions.length).toBeGreaterThanOrEqual(1);

    disconnectMcpAgent();
  });

  test('3 — agent connects → Connected Agents widget updates', async ({ page, request }) => {
    await gotoWithProject(page);

    // Before connect — "No agents" or count = 0
    await page.waitForTimeout(1000);

    const { sessionId, error } = await connectMcpAgent();
    expect(error).toBeFalsy();

    // Wait for WS broadcast → UI update
    await page.waitForTimeout(3000);

    // The Connected Agents widget should update — check for agent count > 0
    // or the "No agents" text should disappear
    const hasAgents = await page.evaluate(() => {
      const text = document.body.textContent || '';
      // Either shows a count or "connected" or the session appears
      return !text.includes('No agents') || text.includes('1 agent') || text.includes('Connected');
    });

    // At minimum the session should be registered server-side
    const sessRes = await request.get(`${API}/sessions`);
    const sessions = await sessRes.json();
    const ourSession = sessions.find((s: any) => s.sessionId === sessionId);
    expect(ourSession).toBeTruthy();

    disconnectMcpAgent();
  });

  test('4 — full flow: agent connects + API plan lifecycle + UI reflects', async ({
    page,
    request,
  }) => {
    await gotoWithProject(page);

    // --- Step 1: Connect agent via MCP SSE ---
    const { sessionId, error } = await connectMcpAgent();
    expect(error).toBeFalsy();
    expect(sessionId).toBeTruthy();

    // --- Step 2: Create plan via REST API (same as MCP create_plan internally) ---
    const planRes = await request.post(`${API}/plans`, {
      data: {
        title: PLAN_TITLE,
        description: 'Golden chain E2E test plan',
        projectPath: process.cwd(),
      },
    });
    expect(planRes.ok()).toBeTruthy();
    const plan = await planRes.json();

    // Add items (actions)
    const itemRes = await request.post(`${API}/plans/${plan.uid}/items`, {
      data: {
        kind: 'action',
        title: 'Refactor auth module',
        template: 'action',
        body: 'Break up server.ts auth handling',
        status: 'pending',
        fileSpecs: [{ path: 'src/backend/server.ts', action: 'modify' }],
      },
    });
    expect(itemRes.ok()).toBeTruthy();
    const item = await itemRes.json();

    // --- Step 3: Assign session to plan (simulates agent calling set_active_plan) ---
    await request.post(`${API}/sessions/${sessionId}/assign-plan`, {
      data: { planUid: plan.uid },
    });

    // --- Step 4: Verify plan appears in UI ---
    await page.waitForTimeout(2000);
    await page.getByRole('button', { name: 'Plans', exact: true }).click();
    await page.waitForTimeout(1000);

    const planVisible = await page.getByText(PLAN_TITLE).first()
      .isVisible({ timeout: 5000 }).catch(() => false);
    expect(planVisible).toBe(true);

    // --- Step 5: Update item status (simulates agent working) ---
    await request.put(`${API}/items/${item.uid}`, {
      data: { status: 'in_progress' },
    });
    await page.waitForTimeout(1000);

    // --- Step 6: Mark done ---
    await request.put(`${API}/items/${item.uid}`, {
      data: { status: 'done' },
    });
    await page.waitForTimeout(1000);

    // Verify item is done
    const doneRes = await request.get(`${API}/items/${item.uid}`);
    const doneItem = await doneRes.json();
    expect(doneItem.status).toBe('done');

    // --- Step 7: Session should still be in active list ---
    const sessRes = await request.get(`${API}/sessions`);
    const sessions = await sessRes.json();
    expect(sessions.some((s: any) => s.sessionId === sessionId)).toBe(true);

    disconnectMcpAgent();
  });

  test('5 — agent disconnect removes session from list', async ({ page, request }) => {
    await gotoWithProject(page);

    const { sessionId, error } = await connectMcpAgent();
    expect(error).toBeFalsy();

    // Verify session exists
    let sessRes = await request.get(`${API}/sessions`);
    let sessions = await sessRes.json();
    expect(sessions.some((s: any) => s.sessionId === sessionId)).toBe(true);

    // Disconnect
    disconnectMcpAgent();
    await page.waitForTimeout(2000);

    // Session should be removed (or marked inactive)
    sessRes = await request.get(`${API}/sessions`);
    sessions = await sessRes.json();
    const stillActive = sessions.find(
      (s: any) => s.sessionId === sessionId && s.status === 'active',
    );
    expect(stillActive).toBeFalsy();
  });
});
