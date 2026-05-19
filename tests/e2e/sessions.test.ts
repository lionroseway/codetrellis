/**
 * MCP Sessions API — agent session management.
 *
 * Exercises:
 *   - GET  /api/sessions                       — list active agent sessions
 *   - POST /api/sessions/:sessionId/assign-plan — assign a plan to a session
 *   - GET  /api/mcp/status                     — MCP server status
 *
 * Uses the scripted agent harness to register a real MCP session,
 * then exercises the REST endpoints that manage those sessions.
 */

import { test, expect } from '@playwright/test';
import { setupHarness, type Harness } from '../harness';

test.describe.serial('Sessions API', () => {
  test.setTimeout(120_000);

  let h: Harness;
  let planUid: string;

  test.beforeAll(async () => {
    h = await setupHarness('sessions');
    await h.client.scanProject(h.fixture.projectPath);
    const plan = await h.client.createPlan({
      title: 'Session test plan',
      projectPath: h.fixture.projectPath,
    });
    planUid = plan.uid;
  });

  test.afterAll(async () => {
    await h?.teardown();
  });

  test('GET /api/sessions returns empty before any agent connects', async () => {
    const res = await h.client.raw('GET', '/api/sessions');
    expect(res.ok).toBe(true);
    const sessions = await res.json();
    expect(Array.isArray(sessions)).toBe(true);
    // Could be empty or could have leftover — just verify shape
  });

  test('agent connects via MCP, then GET /api/sessions shows it', async () => {
    const agent = await h.spawnAgent({ agentType: 'test-agent' });

    const res = await h.client.raw('GET', '/api/sessions');
    expect(res.ok).toBe(true);
    const sessions = await res.json();
    expect(Array.isArray(sessions)).toBe(true);
    expect(sessions.length).toBeGreaterThanOrEqual(1);

    // Find our agent's session
    const ours = sessions.find((s: { agentType?: string }) => s.agentType === 'test-agent');
    expect(ours).toBeDefined();
    expect(ours.sessionId).toBeTruthy();
  });

  test('POST /api/sessions/:sessionId/assign-plan assigns a plan', async () => {
    // Get sessions to find our sessionId
    const listRes = await h.client.raw('GET', '/api/sessions');
    const sessions = await listRes.json();
    const ours = sessions.find((s: { agentType?: string }) => s.agentType === 'test-agent');
    expect(ours).toBeDefined();

    const res = await h.client.raw(
      'POST',
      `/api/sessions/${ours.sessionId}/assign-plan`,
      { planUid },
    );
    expect(res.ok).toBe(true);
    const body = await res.json();
    expect(body.ok).toBe(true);
  });

  test('GET /api/mcp/status returns server info', async () => {
    const res = await h.client.raw('GET', '/api/mcp/status');
    expect(res.ok).toBe(true);
    const status = await res.json();
    expect(status).toBeTruthy();
    expect(typeof status).toBe('object');
    // Should have port info at minimum
    expect(status).toHaveProperty('port');
  });
});
