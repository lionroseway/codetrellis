/**
 * Unverified changes, and turning them off (Phase 32, carried item 2b), end
 * to end against a real backend.
 *
 * A change over plain HTTP (the harness is exactly that: the token, no app
 * window) is recorded as `unverified`, never as the person. With "Accept
 * changes over the local API" off, every such change is refused with where
 * to turn it back on; reading still works, and MCP agents are unaffected.
 * Flipping the setting is a grant: a real backend refuses it over HTTP.
 */

import { test, expect } from '@playwright/test';
import { setupHarness, type Harness, type ScriptedAgent } from '../harness';

test.describe.serial('Changes over the local API', () => {
  test.setTimeout(120_000);

  let h: Harness;
  let agent: ScriptedAgent;
  let planUid: string;

  const setAccept = (value: boolean) => h.client.raw('PUT', '/api/settings', { mcp: { acceptLocalApiChanges: value } });

  test.beforeAll(async () => {
    h = await setupHarness('local-api-changes');
    await h.client.scanProject(h.fixture.projectPath);
    agent = await h.spawnAgent({ agentType: 'claude-code' });
    const res = await h.client.raw('POST', '/api/plans', { title: 'Local API plan', projectPath: h.fixture.projectPath });
    expect(res.ok).toBe(true);
    planUid = ((await res.json()) as { uid: string }).uid;
  });

  test.afterAll(async () => { await h?.teardown(); });

  test('by default a change over plain HTTP is accepted and recorded as unverified, not as you', async () => {
    const res = await h.client.raw('POST', '/api/comments', { targetType: 'plan', targetUid: planUid, body: 'from a script' });
    expect(res.status).toBe(200);
    expect(((await res.json()) as { authorType: string }).authorType).toBe('unverified');
  });

  test('turned off: every change over plain HTTP is refused, with where to turn it back on', async () => {
    expect((await setAccept(false)).status).toBe(200);
    for (const [method, path, body] of [
      ['POST', '/api/comments', { targetType: 'plan', targetUid: planUid, body: 'refused' }],
      ['POST', '/api/plans', { title: 'refused', projectPath: h.fixture.projectPath }],
      ['DELETE', `/api/plans/${planUid}`, undefined],
    ] as const) {
      const res = await h.client.raw(method, path, body);
      expect(res.status, `${method} ${path}`).toBe(403);
      expect(((await res.json()) as { error: string }).error).toContain('Settings → MCP Server → Local API');
    }
  });

  test('turned off: reading still works, and agents over MCP are not affected', async () => {
    expect((await h.client.raw('GET', `/api/plans/${planUid}`)).status).toBe(200);
    const made = await agent.callTool('create_plan', { title: 'From an agent over MCP', project_path: h.fixture.projectPath });
    expect(made.isError).toBeFalsy();
  });

  test('turned back on, changes are accepted again', async () => {
    expect((await setAccept(true)).status).toBe(200);
    expect((await h.client.raw('POST', '/api/comments', { targetType: 'plan', targetUid: planUid, body: 'accepted again' })).status).toBe(200);
  });
});

test.describe.serial('Who may turn it off', () => {
  test.setTimeout(120_000);
  let h: Harness;

  test.beforeAll(async () => {
    // A backend that refuses grants over plain HTTP, as a real one does.
    h = await setupHarness('local-api-changes-grant', { env: { CODETRELLIS_ALLOW_HTTP_GRANTS: '0' } });
  });
  test.afterAll(async () => { await h?.teardown(); });

  test('only the app window: plain HTTP cannot turn it off (either direction is a grant: see the unit test)', async () => {
    const res = await h.client.raw('PUT', '/api/settings', { mcp: { acceptLocalApiChanges: false } });
    expect(res.status).toBe(403);
    expect(((await res.json()) as { error: string }).error).toContain('Only you can change mcp.acceptLocalApiChanges');
  });
});
