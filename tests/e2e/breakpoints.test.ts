/**
 * Breakpoints (Phase 32 B4.1), end to end: a person marks where an agent
 * must stop and ask, a real agent over MCP is held there, waits, is
 * answered, and the wait survives the app restarting.
 *
 * Journey K1: Sam sets a breakpoint on the payments work. Codex claims a
 * task under it and is told "paused: waiting for a decision"; nothing is
 * claimed. Sam answers "go ahead, but don't change the refund path"; Codex's
 * wait returns that, and its next claim goes through with the note. A spec
 * breakpoint holds an edit the same way, across a restart, and "stop"
 * refuses it. Every hit and answer is on the Timeline.
 */

import { test, expect } from '@playwright/test';
import { setupHarness, startBackend, createClient, createMcpClient, type Harness, type RunningBackend, type ScriptedMcp } from '../harness';

interface Hit { ref: string; kind: string; action: string; tool: string; itemUid: string; itemTitle: string; agent: string; decision: string | null; note: string | null; answeredByType: string | null }
interface Stored { type: string; payload: Record<string, unknown> }

test.describe.serial('Breakpoints', () => {
  test.setTimeout(120_000);

  let h: Harness;
  let root: string;
  let planUid: string;
  let payments: string;
  let refunds: string;
  let agent: ScriptedMcp;
  let client: ReturnType<typeof createClient>;
  let backend: { mcpPort: number; capabilityToken: string };
  let taskBp: string;
  let specBp: string;
  let specRef: string;
  const running: RunningBackend[] = [];

  const raw = (method: string, url: string, body?: unknown) => client.raw(method, url, body);
  const json = async <T>(method: string, url: string, body?: unknown) => (await (await raw(method, url, body)).json()) as T;
  const waiting = async () => (await json<{ hits: Hit[] }>('GET', `/api/breakpoint-hits?plan=${planUid}`)).hits;
  const item = async (uid: string) => json<{ status: string | null; body: string; assignee: string | null }>('GET', `/api/items/${uid}`);
  const call = async (tool: string, args: Record<string, unknown>) => {
    const r = await agent.callTool(tool, args);
    let first: Record<string, unknown> = {};
    try { first = JSON.parse(r.answer); } catch { /* not JSON */ }
    return { ...r, first };
  };
  const connect = async () => {
    agent = createMcpClient({ mcpPort: backend.mcpPort, capabilityToken: backend.capabilityToken, clientName: 'codex', roots: [root] });
    await agent.connect();
  };

  test.beforeAll(async () => {
    h = await setupHarness('breakpoints');
    root = h.fixture.projectPath;
    client = h.client;
    backend = h.backend;
    await h.client.scanProject(root);
    planUid = (await h.client.createPlan({ title: 'Checkout', projectPath: root })).uid;
    payments = (await json<{ uid: string }>('POST', `/api/plans/${planUid}/items`, { kind: 'object', title: 'Payments' })).uid;
    refunds = (await json<{ uid: string }>('POST', `/api/plans/${planUid}/items`, { kind: 'action', title: 'Partial refunds', parentUid: payments })).uid;
    await connect();
  });

  test.afterAll(async () => {
    await agent?.disconnect().catch(() => {});
    for (const b of running) await b.stop().catch(() => {});
    await h?.teardown();
  });

  test('a person sets a breakpoint on a task; the plan comes from the item, and setting it twice is one', async () => {
    const res = await raw('POST', '/api/breakpoints', { kind: 'task', itemUid: payments, note: 'Ask me before touching payments', planUid: 'not-this-one' });
    expect(res.status).toBe(201);
    const { breakpoint } = (await res.json()) as { breakpoint: { id: string; planUid: string; createdByType: string; targetTitle: string } };
    expect(breakpoint).toMatchObject({ planUid, createdByType: 'unverified', targetTitle: 'Payments' });
    taskBp = breakpoint.id;

    const again = await raw('POST', '/api/breakpoints', { kind: 'task', itemUid: payments });
    expect(again.status).toBe(200);
    expect(((await again.json()) as { breakpoint: { id: string } }).breakpoint.id).toBe(taskBp);
    expect((await raw('POST', '/api/breakpoints', { kind: 'everything', itemUid: payments })).status).toBe(400);
    expect((await raw('POST', '/api/breakpoints', { kind: 'task', itemUid: 'no-such-item' })).status).toBe(404);
    expect((await json<{ breakpoints: Array<{ id: string }> }>('GET', `/api/breakpoints?plan=${planUid}`)).breakpoints.map((b) => b.id)).toEqual([taskBp]);
    expect(((await (await raw('GET', '/api/breakpoints')).json()) as { breakpoints: Array<{ id: string }> }).breakpoints.map((b) => b.id)).toEqual([taskBp]);
  });

  test('the agent\'s claim of a task under it is paused: nothing is claimed, and asking again gives the same ref', async () => {
    const first = await call('claim_item', { uid: refunds });
    expect(first.isError).toBeFalsy();
    expect(first.first).toMatchObject({ paused: true, status: 'paused: waiting for a decision', breakpoint: { kind: 'task', note: 'Ask me before touching payments' } });
    expect(String(first.first.message)).toContain('claiming “Partial refunds”');
    const ref = String(first.first.ref);
    expect((await item(refunds)).status).toBe('pending');

    expect((await call('claim_item', { uid: refunds })).first.ref).toBe(ref);
    const list = await waiting();
    expect(list).toHaveLength(1);
    expect(((await (await raw('GET', '/api/breakpoint-hits')).json()) as { hits: Hit[] }).hits.map((x) => x.ref)).toEqual([ref]);
    expect(list[0]).toMatchObject({ ref, kind: 'task', action: 'claim', tool: 'claim_item', itemUid: refunds, itemTitle: 'Partial refunds', agent: 'codex', decision: null });

    // Waiting: await_decision says so, and to call again.
    const still = JSON.parse((await agent.callTool('await_decision', { ref, wait_seconds: 0.5 })).answer) as Record<string, unknown>;
    expect(still).toMatchObject({ status: 'waiting', ref });
  });

  test('a person answers with a steer; the waiting agent gets it, and its next claim goes through with the note', async () => {
    const ref = (await waiting())[0].ref;
    const wait = agent.callTool('await_decision', { ref, wait_seconds: 20 });
    // Refused answers first: no decision, a steer with no note, an unknown ref.
    expect((await raw('POST', `/api/breakpoint-hits/${ref}/answer`, { decision: 'maybe' })).status).toBe(400);
    expect((await raw('POST', `/api/breakpoint-hits/${ref}/answer`, { decision: 'steer', note: '  ' })).status).toBe(400);
    expect((await raw('POST', '/api/breakpoint-hits/bp-nope/answer', { decision: 'continue' })).status).toBe(404);

    const res = await raw('POST', `/api/breakpoint-hits/${ref}/answer`, { decision: 'steer', note: "Go ahead, but don't change the refund path", by: 'Priya' });
    expect(res.status).toBe(200);
    expect(((await res.json()) as { hit: Hit }).hit).toMatchObject({ decision: 'steer', answeredByType: 'unverified' });
    expect((await raw('POST', `/api/breakpoint-hits/${ref}/answer`, { decision: 'stop' })).status).toBe(409);

    const answer = JSON.parse((await wait).answer) as Record<string, unknown>;
    expect(answer).toMatchObject({ status: 'answered', decision: 'steer', note: "Go ahead, but don't change the refund path" });
    expect(await waiting()).toEqual([]);

    const claimed = await call('claim_item', { uid: refunds });
    expect(claimed.first).toMatchObject({ ok: true });
    expect(claimed.text).toContain("continue, with this steer: Go ahead, but don't change the refund path");
    expect((await item(refunds)).status).toBe('assigned');
  });

  test('marking it done is its own pause', async () => {
    const done = await call('update_item', { uid: refunds, status: 'done' });
    expect(done.first).toMatchObject({ paused: true });
    expect((await item(refunds)).status).toBe('assigned');
    const ref = String(done.first.ref);
    await raw('POST', `/api/breakpoint-hits/${ref}/answer`, { decision: 'continue' });
    expect((await call('update_item', { uid: refunds, status: 'done' })).first).toMatchObject({ status: 'done' });
  });

  test('a spec breakpoint holds an edit of the description; the wait survives a restart', async () => {
    specBp = (await json<{ breakpoint: { id: string } }>('POST', '/api/breakpoints', { kind: 'spec', itemUid: refunds })).breakpoint.id;
    const before = (await item(refunds)).body;
    const held = await call('update_item', { uid: refunds, body: 'Refund any amount up to the total.' });
    expect(held.first).toMatchObject({ paused: true, breakpoint: { kind: 'spec' } });
    specRef = String(held.first.ref);
    expect((await item(refunds)).body).toBe(before);

    await agent.disconnect();
    await h.backend.stop();
    const b = await startBackend({ dataDir: h.fixture.dataDir });
    running.push(b);
    client = createClient(b.baseUrl, b.capabilityToken);
    backend = b;
    await client.scanProject(root);
    await connect();

    expect((await waiting()).map((x) => x.ref)).toEqual([specRef]);
    const still = JSON.parse((await agent.callTool('await_decision', { ref: specRef, wait_seconds: 0.5 })).answer) as Record<string, unknown>;
    expect(still).toMatchObject({ status: 'waiting' });
    // Asking again after the restart is still the same wait, not a second one.
    expect((await call('update_item', { uid: refunds, body: 'Refund any amount up to the total.' })).first.ref).toBe(specRef);
  });

  test('stop refuses the call once, with the note; the next attempt pauses again', async () => {
    expect((await raw('POST', `/api/breakpoint-hits/${specRef}/answer`, { decision: 'stop', note: 'Not until legal has read it' })).status).toBe(200);
    const view = JSON.parse((await agent.callTool('await_decision', { ref: specRef, wait_seconds: 5 })).answer) as Record<string, unknown>;
    expect(view).toMatchObject({ status: 'answered', decision: 'stop', note: 'Not until legal has read it' });

    const before = (await item(refunds)).body;
    const refused = await call('update_item', { uid: refunds, body: 'Refund any amount up to the total.' });
    expect(refused.first).toMatchObject({ stopped: true, note: 'Not until legal has read it' });
    expect((await item(refunds)).body).toBe(before);
    const again = await call('update_item', { uid: refunds, body: 'Refund any amount up to the total.' });
    expect(again.first).toMatchObject({ paused: true });
    expect(again.first.ref).not.toBe(specRef);
  });

  test('clearing a breakpoint lets the waiting call through, and holds nothing after', async () => {
    const ref = (await waiting())[0].ref;
    const res = await raw('DELETE', `/api/breakpoints/${specBp}`);
    expect(res.status).toBe(200);
    expect(((await res.json()) as { released: string[] }).released).toEqual([ref]);
    expect((await raw('DELETE', `/api/breakpoints/${specBp}`)).status).toBe(404);
    expect(JSON.parse((await agent.callTool('await_decision', { ref, wait_seconds: 1 })).answer)).toMatchObject({ decision: 'continue' });

    expect((await call('update_item', { uid: refunds, body: 'Refund any amount up to the total.' })).first).toMatchObject({ body: 'Refund any amount up to the total.' });
    expect((await raw('DELETE', `/api/breakpoints/${taskBp}`)).status).toBe(200);
    expect((await json<{ breakpoints: unknown[] }>('GET', '/api/breakpoints')).breakpoints).toEqual([]);
    expect((await json<{ hits: Hit[] }>('GET', `/api/breakpoint-hits?state=all&plan=${planUid}`)).hits.length).toBe(4);
    expect((await agent.callTool('await_decision', { ref: 'bp-nope', wait_seconds: 0 })).isError).toBe(true);
  });

  test('every hit and answer is on the Timeline, and the held call says it was paused', async () => {
    let events: Stored[] = [];
    await expect.poll(async () => {
      events = ((await json<{ events: Stored[] }>('GET', '/api/agent-events')).events);
      return events.filter((e) => e.type === 'breakpoint_answered').length;
    }, { timeout: 10_000 }).toBe(4);
    const hits = events.filter((e) => e.type === 'breakpoint_hit');
    expect(hits.map((e) => e.payload.action)).toEqual(['claim', 'done', 'edit', 'edit']);
    expect(hits[0].payload).toMatchObject({ itemTitle: 'Partial refunds', agent: 'codex', planUid });
    const answers = events.filter((e) => e.type === 'breakpoint_answered').map((e) => e.payload.decision);
    expect(answers).toEqual(['steer', 'continue', 'stop', 'continue']);
    // The paused tool call is itself on the Timeline, saying so.
    expect(events.some((e) => e.type === 'tool_call' && e.payload.tool === 'claim_item' && String(e.payload.summary ?? '').startsWith('Paused at a breakpoint'))).toBe(true);
  });
});
