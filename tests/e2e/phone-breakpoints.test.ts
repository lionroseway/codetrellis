/**
 * Breakpoints on the phone (Phase 32 B4.4), end to end.
 *
 * Journey K1, away from the desk: Sam has asked to be asked before an agent
 * touches payments. Codex claims a task under it and is held. Sam's phone
 * lists the held claim first, in the words the desktop uses; Sam answers
 * "go ahead, but don't change the refund path" from the phone. Codex's
 * wait returns that note, its claim goes through, and the answer is Sam's:
 * a person, not "unverified" as a plain HTTP answer would be, audited
 * against the phone, and the desktop told. An open phone is not pushed:
 * its live count of held calls moves, and it reads the list.
 *
 * A phone allowed only to read sees what is held but cannot answer it.
 */

import { test, expect } from '@playwright/test';
import { setupHarness, createMcpClient, openEventStream, pairPhone, type Harness, type ScriptedMcp, type Phone, type EventStream } from '../harness';

interface PhoneHit {
  ref: string; breach: boolean; headline: string; why: string; labels: Record<string, string>;
  breakpointNote: string | null; agent: string | null; planUid: string | null; itemUid: string | null;
  decision: string | null; note: string | null; answeredAt: number | null;
}

test.describe.serial('Breakpoints on the phone', () => {
  test.setTimeout(120_000);

  let h: Harness;
  let root: string;
  let planUid: string;
  let refunds: string;
  let agent: ScriptedMcp;
  let phone: Phone;
  let events: EventStream;
  let ref: string;

  const raw = (method: string, url: string, body?: unknown) => h.client.raw(method, url, body);
  const json = async <T>(method: string, url: string, body?: unknown) => (await (await raw(method, url, body)).json()) as T;
  const first = async (tool: string, args: Record<string, unknown>) => {
    const r = await agent.callTool(tool, args);
    let parsed: Record<string, unknown> = {};
    try { parsed = JSON.parse(r.answer); } catch { /* not JSON */ }
    return { ...r, first: parsed };
  };

  test.beforeAll(async () => {
    h = await setupHarness('phone-breakpoints');
    root = h.fixture.projectPath;
    await h.client.scanProject(root);
    planUid = (await h.client.createPlan({ title: 'Checkout', projectPath: root })).uid;
    const payments = (await json<{ uid: string }>('POST', `/api/plans/${planUid}/items`, { kind: 'object', title: 'Payments' })).uid;
    refunds = (await json<{ uid: string }>('POST', `/api/plans/${planUid}/items`, { kind: 'action', title: 'Partial refunds', parentUid: payments })).uid;
    expect((await raw('POST', '/api/breakpoints', { kind: 'task', itemUid: payments, note: 'Ask me before touching payments' })).status).toBe(201);
    agent = createMcpClient({ mcpPort: h.backend.mcpPort, capabilityToken: h.backend.capabilityToken, clientName: 'codex', roots: [root] });
    await agent.connect();
    events = await openEventStream(h.backend);
    phone = await pairPhone(h.client, { alias: 'Sam’s phone' });
  });

  test.afterAll(async () => {
    await phone?.close().catch(() => {});
    events?.close();
    await agent?.disconnect().catch(() => {});
    await h?.teardown();
  });

  test('nothing held: the phone\'s list is empty, and its live count is 0', async () => {
    expect((await phone.rpc<{ hits: PhoneHit[] }>('breakpoint.waiting')).hits).toEqual([]);
    expect(phone.state().waitingBreakpoints).toBe(0);
  });

  test('an agent is held; the phone lists it in the desktop\'s words, with the person\'s note and the three answers', async () => {
    const held = await first('claim_item', { uid: refunds });
    expect(held.first).toMatchObject({ paused: true, status: 'paused: waiting for a decision' });
    ref = String(held.first.ref);
    // An open phone gets no push: its live count moves, and it reads the list.
    await phone.waitForState((s) => s.waitingBreakpoints === 1);

    const { hits } = await phone.rpc<{ hits: PhoneHit[] }>('breakpoint.waiting');
    expect(hits).toHaveLength(1);
    expect(hits[0]).toMatchObject({
      ref, breach: false, agent: 'codex', planUid, itemUid: refunds,
      headline: 'codex in main wants to claim “Partial refunds”', // the agent works in the main checkout, as the window says too
      breakpointNote: 'Ask me before touching payments',
      labels: { continue: 'Continue', steer: 'Continue with steer', stop: 'Stop' },
      decision: null, answeredAt: null,
    });
    expect(hits[0].why).toContain('before an agent claims or finishes this task');
  });

  test('refused from the phone: a steer with no note, a decision that is not one, a hit that does not exist', async () => {
    expect(await phone.rpcError('breakpoint.answer', { ref, decision: 'steer', note: '  ' })).toMatch(/A steer needs a note/);
    expect(await phone.rpcError('breakpoint.answer', { ref, decision: 'maybe' })).toMatch(/decision must be one of/);
    expect(await phone.rpcError('breakpoint.answer', { ref: 'bp-nope', decision: 'continue' })).toMatch(/No such breakpoint hit/);
  });

  test('answered from the phone: the agent gets the note and carries on; the answer is the person\'s, audited, the desktop told', async () => {
    const wait = agent.callTool('await_decision', { ref, wait_seconds: 20 });
    const told = events.waitFor('breakpoint-answered', (p) => p.ref === ref);
    const answered = await phone.rpc<{ hit: PhoneHit; alreadyAnswered?: true }>('breakpoint.answer', {
      ref, decision: 'steer', note: "Go ahead, but don't change the refund path", author: 'Priya',
    });
    expect(answered.alreadyAnswered).toBeUndefined();
    expect(answered.hit).toMatchObject({ ref, decision: 'steer', note: "Go ahead, but don't change the refund path" });
    expect(await told).toMatchObject({ ref, planUid, decision: 'steer' });

    const answer = JSON.parse((await wait).answer) as Record<string, unknown>;
    expect(answer).toMatchObject({ status: 'answered', decision: 'steer', note: "Go ahead, but don't change the refund path" });
    const claimed = await first('claim_item', { uid: refunds });
    expect(claimed.first).toMatchObject({ ok: true });
    expect(claimed.text).toContain("continue, with this steer: Go ahead, but don't change the refund path");

    // A person on a confirmed phone, never "unverified", and never the name the request carried.
    const all = await json<{ hits: Array<{ ref: string; answeredByType: string; answeredBy: string }> }>('GET', '/api/breakpoint-hits?state=all');
    const stored = all.hits.find((x) => x.ref === ref)!;
    expect(stored.answeredByType).toBe('human');
    expect(stored.answeredBy).not.toBe('Priya');
    const audit = await json<unknown>('GET', `/api/peers/audit?fingerprint=${encodeURIComponent(phone.fingerprint)}`);
    const entries = (Array.isArray(audit) ? audit : (audit as { entries: Array<{ method: string; kind: string }> }).entries) as Array<{ method: string; kind: string }>;
    expect(entries.some((e) => e.method === 'breakpoint.answer' && e.kind === 'decision')).toBe(true);
    expect((await phone.rpc<{ hits: PhoneHit[] }>('breakpoint.waiting')).hits).toEqual([]);
    await phone.waitForState((s) => s.waitingBreakpoints === 0);
  });

  test('the first answer stands: a second answer from the phone gets the one that stood', async () => {
    const again = await phone.rpc<{ hit: PhoneHit; alreadyAnswered?: true }>('breakpoint.answer', { ref, decision: 'stop' });
    expect(again).toMatchObject({ alreadyAnswered: true, hit: { ref, decision: 'steer' } });
  });

  test('a phone allowed only to read sees what is held, and cannot answer it', async () => {
    const done = await first('update_item', { uid: refunds, status: 'done' });
    expect(done.first).toMatchObject({ paused: true });
    const heldRef = String(done.first.ref);

    await phone.grant(['read']);
    const { hits } = await phone.rpc<{ hits: PhoneHit[] }>('breakpoint.waiting');
    expect(hits.map((x) => x.ref)).toEqual([heldRef]);
    expect(hits[0].headline).toBe('codex in main wants to mark done “Partial refunds”');
    expect(await phone.rpcError('breakpoint.answer', { ref: heldRef, decision: 'continue' })).toMatch(/write/i);
    expect((await json<{ hits: Array<{ ref: string }> }>('GET', `/api/breakpoint-hits?plan=${planUid}`)).hits.map((x) => x.ref)).toEqual([heldRef]);
  });
});
