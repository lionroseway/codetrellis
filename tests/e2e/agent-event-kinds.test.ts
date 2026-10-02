/**
 * What the agent event log records beyond tool calls (Phase 32 B1.2), end to
 * end: a real agent over MCP and the running backend.
 *
 *  - A call the MCP SDK refuses before the tool runs (an unknown tool, or
 *    arguments its schema rejects) is recorded as a tool_error, once. Before,
 *    it reached neither the Timeline nor the log.
 *  - A spec body edited is an event: made by an agent's tool, it joins that
 *    agent's session; made over the local API, it says so and stands alone.
 */

import { test, expect } from '@playwright/test';
import { setupHarness, createMcpClient, type Harness, type ScriptedMcp } from '../harness';

interface Stored {
  id: string; type: string; source: string; sessionId: string | null; agentType: string | null;
  payload: Record<string, unknown>;
}

test.describe.serial('What the event log records', () => {
  test.setTimeout(120_000);

  let h: Harness;
  let root: string;
  let agent: ScriptedMcp;
  let planUid: string;

  const events = async () => ((await (await h.client.raw('GET', '/api/agent-events?limit=2000')).json()) as { events: Stored[] }).events;
  const poll = <T>(fn: () => Promise<T>) => expect.poll(fn, { timeout: 10_000, intervals: [200] });

  test.beforeAll(async () => {
    h = await setupHarness('agent-event-kinds');
    root = h.fixture.projectPath;
    await h.client.scanProject(root);
    planUid = (await h.client.createPlan({ title: 'B1.2 plan', projectPath: root })).uid;
    agent = createMcpClient({ mcpPort: h.backend.mcpPort, capabilityToken: h.backend.capabilityToken, clientName: 'codex', roots: [root] });
    await agent.connect();
  });

  test.afterAll(async () => {
    await agent?.disconnect().catch(() => {});
    await h?.teardown();
  });

  test('arguments the SDK\'s schema rejects: recorded as an error, once, saying why', async () => {
    const r = await agent.callTool('get_app_guide', { flavor: 'no-such-flavour' });
    expect(r.isError).toBe(true);
    await poll(async () => (await events()).filter((e) => e.type === 'tool_error' && e.payload.tool === 'get_app_guide').length).toBe(1);
    const [e] = (await events()).filter((x) => x.type === 'tool_error' && x.payload.tool === 'get_app_guide');
    expect(String(e.payload.error)).toContain('Invalid arguments');
    expect(e).toMatchObject({ source: 'mcp', agentType: 'codex' });
    expect(e.sessionId).toBeTruthy();
  });

  test('a tool that does not exist: recorded as an error too', async () => {
    const r = await agent.callTool('no_such_tool', {});
    expect(r.isError).toBe(true);
    await poll(async () => (await events()).filter((e) => e.type === 'tool_error' && e.payload.tool === 'no_such_tool').length).toBe(1);
  });

  test('a call refused at the interception is still recorded once, not twice', async () => {
    expect((await agent.callTool('terminal_list', {})).isError).toBe(true);
    await poll(async () => (await events()).filter((e) => e.type === 'tool_error' && e.payload.tool === 'terminal_list').length).toBe(1);
    await new Promise((r) => setTimeout(r, 500));
    expect((await events()).filter((e) => e.type === 'tool_error' && e.payload.tool === 'terminal_list')).toHaveLength(1);
  });

  test('an agent editing an item\'s body: the edit joins its session, with the new version', async () => {
    const created = await h.client.raw('POST', `/api/plans/${planUid}/items`, { kind: 'action', title: 'Rotate refresh tokens', body: 'first' });
    const item = (await created.json()) as { uid: string };
    expect((await agent.callTool('update_item', { uid: item.uid, body: 'rotate on every use' })).isError).toBeFalsy();

    let edit: Stored | undefined;
    await poll(async () => {
      edit = (await events()).find((e) => e.type === 'spec_edited' && e.payload.uid === item.uid);
      return !!edit;
    }).toBe(true);
    const call = (await events()).find((e) => e.type === 'tool_call' && e.payload.tool === 'update_item')!;
    expect(edit).toMatchObject({ source: 'app', sessionId: call.sessionId, agentType: 'codex' });
    expect(edit!.payload).toMatchObject({ kind: 'item', planUid, title: 'Rotate refresh tokens' });
    expect(typeof edit!.payload.version).toBe('number');
    // Changing only the status is not a body edit.
    await agent.callTool('update_item', { uid: item.uid, status: 'in_progress' });
    await new Promise((r) => setTimeout(r, 500));
    expect((await events()).filter((e) => e.type === 'spec_edited' && e.payload.uid === item.uid)).toHaveLength(1);
  });

  test('a tool call from a bound session names its workstream as it happens, for its Timeline lane (B2.1)', async () => {
    // The session binds from MCP roots shortly after connect; once it has, its calls carry the root.
    await poll(async () => {
      await agent.callTool('list_plans', {});
      const calls = (await events()).filter((e) => e.type === 'tool_call' && e.payload.tool === 'list_plans');
      return calls.at(-1)?.payload.workstreamRoot ?? null;
    }).toBe(root);
  });

  test('a spec edited over the local API: said to be unverified, in no agent\'s session', async () => {
    const doc = (await (await h.client.raw('POST', `/api/plans/${planUid}/docs`, { docType: 'spec', title: 'Token rotation', body: 'v1' })).json()) as { uid: string };
    expect((await h.client.raw('PUT', `/api/plan-docs/${doc.uid}`, { body: 'v2: rotate on use', changeSummary: 'Rotation rule' })).ok).toBe(true);
    let edit: Stored | undefined;
    await poll(async () => {
      edit = (await events()).find((e) => e.type === 'spec_edited' && e.payload.uid === doc.uid);
      return !!edit;
    }).toBe(true);
    expect(edit!.sessionId).toBeNull();
    expect(edit!.payload).toMatchObject({ kind: 'document', title: 'Token rotation', version: 2, authorType: 'unverified', changeSummary: 'Rotation rule' });
    expect(edit!.agentType).toBe('unverified');
    // A title-only change is not a body edit.
    await h.client.raw('PUT', `/api/plan-docs/${doc.uid}`, { title: 'Token rotation rules' });
    await new Promise((r) => setTimeout(r, 500));
    expect((await events()).filter((e) => e.type === 'spec_edited' && e.payload.uid === doc.uid)).toHaveLength(1);
  });
});
