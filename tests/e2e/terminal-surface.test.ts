/**
 * Terminals, checked for what they do (Phase 32 §0.4i).
 *
 * The existing tests created, listed, killed, and wrote through MCP. Not
 * checked: that text injected over REST reaches the shell and its
 * scrollback, what history returns, resize and focus, the self-write
 * guard, and what happens to a terminal that is gone.
 */

import { test, expect } from '@playwright/test';
import { setupHarness, openEventStream, type Harness, type ScriptedAgent, type EventStream } from '../harness';

interface Session { id: string; alive: boolean; cols?: number; rows?: number }

test.describe.serial('Terminal surface', () => {
  test.setTimeout(90_000);

  let h: Harness;
  let agent: ScriptedAgent;
  let events: EventStream;
  let shell: Session;

  const req = async (method: string, url: string, body?: unknown) => {
    const res = await h.client.raw(method, url, body);
    expect(res.ok, `${method} ${url}: ${res.status} ${await res.clone().text()}`).toBe(true);
    return res.json();
  };
  const history = async (id: string) => (await req('GET', `/api/terminals/${id}/history`)) as { data: string; fileSize: number; hasMore: boolean };

  test.beforeAll(async () => {
    h = await setupHarness('terminal-surface');
    await h.client.scanProject(h.fixture.projectPath);
    await h.client.grantMcpCapabilities(['read', 'write', 'project', 'files', 'terminal']);
    agent = await h.spawnAgent({ agentType: 'claude-desktop' });
    events = await openEventStream(h.backend);
    shell = await req('POST', '/api/terminals', { preset: 'shell', title: 'Surface', cwd: h.fixture.projectPath });
  });

  test.afterAll(async () => {
    await events?.close();
    await h?.teardown();
  });

  test('text injected over REST runs in the shell and lands in its scrollback', async () => {
    expect(await req('POST', `/api/terminals/${shell.id}/inject`, { text: 'echo injected-$((6*7))\n' })).toEqual({ ok: true });
    await expect.poll(async () => (await history(shell.id)).data, { timeout: 15_000 }).toContain('injected-42');
    const h1 = await history(shell.id);
    expect(h1.fileSize).toBeGreaterThan(0);
    expect((await h.client.raw('POST', `/api/terminals/${shell.id}/inject`, {})).status).toBe(400);
    expect((await h.client.raw('POST', '/api/terminals/no-such-terminal/inject', { text: 'x' })).status).toBe(404);
  });

  test('history pages backwards through the scrollback', async () => {
    const all = await history(shell.id);
    const tail = (await req('GET', `/api/terminals/${shell.id}/history?limit=8`)) as { data: string; prevOffset: number; hasMore: boolean };
    expect(tail.data.length).toBeLessThanOrEqual(8);
    expect(all.data.endsWith(tail.data)).toBe(true);
    expect(tail.hasMore).toBe(true);
    const earlier = (await req('GET', `/api/terminals/${shell.id}/history?before=${tail.prevOffset}&limit=8`)) as { data: string };
    expect(all.data).toContain(earlier.data + tail.data);
    // A terminal with no scrollback reads as empty, and creates nothing.
    expect((await history('never-created')).data).toBe('');
  });

  test('terminal_resize and terminal_focus act on a live terminal, and refuse one that is not', async () => {
    const resized = await agent.callTool('terminal_resize', { session_id: shell.id, cols: 120, rows: 40 });
    expect(resized.isError, resized.text).not.toBe(true);
    expect(resized.text).toBe(`Resized ${shell.id} to 120x40`);
    await req('POST', `/api/terminals/${shell.id}/inject`, { text: 'echo cols-$(tput cols)\n' });
    await expect.poll(async () => (await history(shell.id)).data, { timeout: 15_000 }).toContain('cols-120');

    const focused = await agent.callTool('terminal_focus', { session_id: shell.id });
    expect(focused.isError, focused.text).not.toBe(true);
    await events.waitFor('ui-terminal-focus', (p) => p.sessionId === shell.id);

    expect((await agent.callTool('terminal_resize', { session_id: 'no-such-terminal', cols: 120, rows: 40 })).isError).toBe(true);
    expect((await agent.callTool('terminal_focus', { session_id: 'no-such-terminal' })).isError).toBe(true);
  });

  test('an agent cannot type into its own host terminal', async () => {
    const own = await req('POST', '/api/terminals', { preset: 'shell', title: 'Agent host', cwd: h.fixture.projectPath }) as Session;
    const hosted = await h.spawnAgent({ agentType: 'hosted-agent' });
    await hosted.callTool('register_session', { agent_type: 'hosted-agent', host_terminal_id: own.id });
    const res = await hosted.callTool('terminal_write', { session_id: own.id, input: 'echo loop\n' });
    expect(res.isError).toBe(true);
    expect(res.text).toMatch(/your own host terminal/);
    // Another terminal is fine.
    const other = await hosted.callTool('terminal_write', { session_id: shell.id, input: 'echo from-hosted\n' });
    expect(other.isError, other.text).not.toBe(true);
    await expect.poll(async () => (await history(shell.id)).data, { timeout: 15_000 }).toContain('from-hosted');
  });

  test('a killed terminal is gone for every route and tool', async () => {
    expect(await req('DELETE', `/api/terminals/${shell.id}`)).toEqual({ ok: true });
    await events.waitFor('terminal-killed', (p) => p.id === shell.id);
    const list = (await req('GET', '/api/terminals')) as Session[];
    const listed = list.find((s) => s.id === shell.id);
    expect(!listed || listed.alive === false).toBe(true);
    expect((await h.client.raw('POST', `/api/terminals/${shell.id}/inject`, { text: 'x\n' })).status).toBe(404);
    expect((await agent.callTool('terminal_write', { session_id: shell.id, input: 'x\n' })).isError).toBe(true);
    expect((await h.client.raw('DELETE', '/api/terminals/no-such-terminal')).status).toBe(404);
    // What it printed is still readable.
    expect((await history(shell.id)).data).toContain('injected-42');
  });
});
