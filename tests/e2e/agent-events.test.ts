/**
 * The agent event log (Phase 32 B1), end to end: a real agent over MCP, the
 * running backend, and a restart.
 *
 * Tool calls and sessions were broadcast and then lost; a reload emptied the
 * Timeline. Now each is written down as it is broadcast, stamped with the
 * session, the agent and the workstream it works in, with secrets masked,
 * and it is still there after the app restarts.
 */

import { test, expect } from '@playwright/test';
import { setupHarness, startBackend, createClient, createMcpClient, type Harness, type RunningBackend, type ScriptedMcp } from '../harness';

interface Stored {
  id: string; timestamp: number; source: string; type: string;
  sessionId: string | null; agentType: string | null; workstreamRoot: string | null;
  payload: Record<string, unknown>;
}

test.describe.serial('The agent event log', () => {
  test.setTimeout(120_000);

  let h: Harness;
  let root: string;
  let agent: ScriptedMcp;
  const running: RunningBackend[] = [];

  const events = async (client = h.client, query = '') =>
    ((await (await client.raw('GET', `/api/agent-events?${query}`)).json()) as { events: Stored[] }).events;

  test.beforeAll(async () => {
    h = await setupHarness('agent-events');
    root = h.fixture.projectPath;
    await h.client.scanProject(root);
    agent = createMcpClient({ mcpPort: h.backend.mcpPort, capabilityToken: h.backend.capabilityToken, clientName: 'codex', roots: [root] });
    await agent.connect();
  });

  test.afterAll(async () => {
    await agent?.disconnect().catch(() => {});
    for (const b of running) await b.stop().catch(() => {});
    await h?.teardown();
  });

  test('a tool call is kept with its session, its agent and its workstream', async () => {
    expect((await agent.callTool('list_plans', {})).isError).toBeFalsy();
    let call: Stored | undefined;
    await expect.poll(async () => {
      call = (await events()).find((e) => e.type === 'tool_call' && e.payload.tool === 'list_plans');
      return call?.workstreamRoot ?? null;
    }, { timeout: 10_000 }).toBe(root);
    expect(call).toMatchObject({ source: 'mcp', agentType: 'codex' });
    expect(call!.sessionId).toBeTruthy();
    expect(call!.id).toMatch(/^mcp-tool-[0-9a-f]{8}-\d+$/);
    // Its session's start is there too, by the same session.
    const start = (await events()).find((e) => e.type === 'session_start' && e.sessionId === call!.sessionId);
    expect(start).toBeTruthy();
  });

  test('a secret in a tool\'s arguments is masked before it is written', async () => {
    await agent.callTool('search_symbols', { query: 'password=hunter2' });
    let call: Stored | undefined;
    await expect.poll(async () => {
      call = (await events()).find((e) => e.payload.tool === 'search_symbols');
      return !!call;
    }, { timeout: 10_000 }).toBe(true);
    expect(String(call!.payload.args)).toContain('password=[redacted]');
    expect(JSON.stringify(await events())).not.toContain('hunter2');
  });

  test('a call the server refuses is kept as an error', async () => {
    // Refused at the interception: `terminal` is not granted by default.
    const r = await agent.callTool('terminal_list', {});
    expect(r.isError).toBe(true);
    await expect.poll(async () => (await events()).some((e) => e.type === 'tool_error' && e.payload.tool === 'terminal_list'), { timeout: 10_000 }).toBe(true);
  });

  test('it filters by session and workstream, and pages by time', async () => {
    const all = await events();
    const sid = all.find((e) => e.type === 'tool_call')!.sessionId!;
    expect((await events(h.client, `session=${encodeURIComponent(sid)}`)).every((e) => e.sessionId === sid)).toBe(true);
    expect((await events(h.client, `workstream=${encodeURIComponent(root)}`)).length).toBeGreaterThan(0);
    expect(await events(h.client, `workstream=${encodeURIComponent('/nowhere')}`)).toEqual([]);
    expect(await events(h.client, `since=${Date.now() + 60_000}`)).toEqual([]);
    expect((await events(h.client, 'limit=1')).length).toBe(1);
  });

  test('the session ending is kept, still naming its workstream', async () => {
    const sid = (await events()).find((e) => e.type === 'tool_call')!.sessionId!;
    await agent.disconnect();
    await expect.poll(async () => (await events()).find((e) => e.type === 'session_end' && e.sessionId === sid)?.workstreamRoot ?? null, { timeout: 10_000 }).toBe(root);
  });

  test('after a restart, all of it is still there, and new events do not collide with it', async () => {
    const before = await events();
    await h.backend.stop();
    const b = await startBackend({ dataDir: h.fixture.dataDir });
    running.push(b);
    const client = createClient(b.baseUrl, b.capabilityToken);
    const after = await events(client);
    expect(after.map((e) => e.id)).toEqual(before.map((e) => e.id));

    await client.scanProject(root);
    const again = createMcpClient({ mcpPort: b.mcpPort, capabilityToken: b.capabilityToken, clientName: 'codex', roots: [root] });
    await again.connect();
    await again.callTool('list_plans', {});
    await again.disconnect();
    await expect.poll(async () => (await events(client)).filter((e) => e.type === 'tool_call' && e.payload.tool === 'list_plans').length, { timeout: 10_000 }).toBe(2);
    const ids = (await events(client)).map((e) => e.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});
