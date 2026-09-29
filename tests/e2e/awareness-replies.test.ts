/**
 * A person's message to the agents about a signal (Phase 32 A4.1), end to end.
 *
 * Journey C2's reply, from the desktop first: billing-v2's agent changes a
 * function checkout-fix's work imports, and a contract signal opens. Sam
 * writes "keep the old signature until checkout-fix has moved its callers".
 * Each agent in either workstream reads it once, on its next tool call, under
 * the signal it is about; an agent in a third workstream never does. The
 * checkout agent holds a task, so the words are also a `steer` on that plan's
 * channel. The tab lists the message and who has read it.
 *
 * The harness calls over plain HTTP, so the message says it was not verified
 * as the person; the phone's own path (A4.2) is a person.
 */

import { test, expect } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { setupHarness, createMcpClient, openEventStream, type Harness, type ScriptedMcp, type EventStream } from '../harness';

interface Reply { id: number; message: string; by: { actorType: string; channel: string }; at: number; readBy: Array<{ agentType: string }> }
interface Signal { id: string; kind: string; replies?: Reply[] }

const VALIDATORS = 'packages/shared/src/validators.ts';
const USER_LIST = 'packages/web/src/UserList.tsx';
const BLOCK = '── CodeTrellis: a message about other work ──';
const WORDS = 'Keep the old signature until checkout-fix has moved its callers.';
const ENV = { ...process.env, GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@x', GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@x' };

test.describe.serial('Message the agents about a signal', () => {
  test.setTimeout(120_000);

  let h: Harness;
  let root: string;
  let billing: string;
  let checkout: string;
  let exportsDir: string;
  let changer: ScriptedMcp; // billing-v2
  let caller: ScriptedMcp; // checkout-fix, holds a task
  let bystander: ScriptedMcp; // exports, not in the signal
  let events: EventStream;
  let planUid: string;
  let itemUid: string;
  let signalId: string;

  const raw = (method: string, url: string, body?: unknown) => h.client.raw(method, url, body);
  const q = () => `project=${encodeURIComponent(root)}`;
  const edit = (folder: string, rel: string, from: string, to: string) => {
    const f = path.join(folder, rel);
    const was = fs.readFileSync(f, 'utf-8');
    expect(was.includes(from), `${rel} contains the text to change`).toBe(true);
    fs.writeFileSync(f, was.replace(from, to));
  };
  const ordinaryCall = async (agent: ScriptedMcp) => {
    const r = await agent.callTool('list_plans', {});
    expect(r.isError, r.text).toBeFalsy();
    return r.text;
  };
  const signals = async () => ((await (await raw('GET', `/api/awareness?${q()}`)).json()) as { signals: Signal[] }).signals;

  test.beforeAll(async () => {
    h = await setupHarness('awareness-replies', { env: { CODETRELLIS_WORKSTREAM_DEBOUNCE_MS: '150' } });
    root = h.fixture.projectPath;
    billing = `${root}-billing`;
    checkout = `${root}-checkout`;
    exportsDir = `${root}-exports`;
    for (const [dir, branch] of [[billing, 'billing-v2'], [checkout, 'checkout-fix'], [exportsDir, 'exports']]) {
      execFileSync('git', ['-C', root, 'worktree', 'add', '-q', dir, '-b', branch], { env: ENV });
    }
    await h.client.scanProject(root);
    const mcp = (clientName: string, dir: string) => createMcpClient({ mcpPort: h.backend.mcpPort, capabilityToken: h.backend.capabilityToken, clientName, roots: [dir] });
    changer = mcp('claude-code', billing);
    caller = mcp('codex', checkout);
    bystander = mcp('cursor', exportsDir);
    for (const a of [changer, caller, bystander]) await a.connect();
    planUid = (await h.client.createPlan({ title: 'Checkout', projectPath: root })).uid;
    itemUid = ((await (await raw('POST', `/api/plans/${planUid}/items`, { kind: 'action', title: 'Signup form' })).json()) as { uid: string }).uid;
    const claimed = await caller.callTool('claim_item', { uid: itemUid });
    expect(claimed.isError, claimed.text).toBeFalsy();
    edit(checkout, USER_LIST, "import { validateCreateUser } from '@sample/shared';", "import { validateCreateUser } from '@sample/shared';\n// checkout-fix: the signup form");
    events = await openEventStream(h.backend);
    expect((await raw('GET', `/api/workstreams?${q()}`)).ok).toBe(true);
  });

  test.afterAll(async () => {
    events?.close();
    for (const a of [changer, caller, bystander]) await a?.disconnect().catch(() => {});
    for (const w of [billing, checkout, exportsDir]) {
      try { execFileSync('git', ['-C', root, 'worktree', 'remove', '--force', w]); } catch { /* */ }
    }
    await h?.teardown();
  });

  test('a contract signal opens between billing-v2 and checkout-fix', async () => {
    edit(billing, VALIDATORS, 'validateCreateUser(payload: CreateUserPayload)', 'validateCreateUser(payload: CreateUserPayload, strict: boolean)');
    await expect.poll(async () => (await signals()).find((s) => s.kind === 'contract')?.id ?? null, { timeout: 15_000, intervals: [300] }).not.toBeNull();
    signalId = (await signals()).find((s) => s.kind === 'contract')!.id;
    // Clear the notices each agent would get anyway, so what follows is the reply alone.
    for (const a of [changer, caller, bystander]) await ordinaryCall(a);
  });

  test('refused: no words, too many, a signal that is not open, a project not opened', async () => {
    expect((await raw('POST', `/api/awareness/${signalId}/reply?${q()}`, { message: '  ' })).status).toBe(400);
    expect((await raw('POST', `/api/awareness/${signalId}/reply?${q()}`, { message: 'x'.repeat(1001) })).status).toBe(400);
    expect((await raw('POST', `/api/awareness/no-such-signal/reply?${q()}`, { message: 'hi' })).status).toBe(404);
    expect((await raw('POST', `/api/awareness/${signalId}/reply?project=${encodeURIComponent('/not/opened')}`, { message: 'hi' })).status).toBe(403);
    expect((await raw('POST', `/api/awareness/${signalId}/reply`, { message: 'hi' })).status).toBe(400);
    expect((await signals()).find((s) => s.id === signalId)?.replies).toBeUndefined();
  });

  test('Sam replies: kept beside the signal, a steer on the plan of the task checkout-fix holds, and the window told', async () => {
    const res = await raw('POST', `/api/awareness/${signalId}/reply?${q()}`, { message: `  ${WORDS}  ` });
    expect(res.status).toBe(201);
    const body = (await res.json()) as Reply & { signalId: string; steers: string[] };
    expect(body).toMatchObject({ signalId, message: WORDS, by: { actorType: 'unverified', channel: 'local-api' }, readBy: [] });
    expect(body.steers).toHaveLength(1);
    await events.waitFor('awareness-changed');
    await events.waitFor('channel-event-posted', (p: { planUid?: string }) => p.planUid === planUid);

    const list = (await (await raw('GET', `/api/plans/${planUid}/channels`)).json()) as Array<{ uid: string; eventType: string; itemUid: string; payload: { message: string }; authorType: string }>;
    const steer = list.find((e) => e.uid === body.steers[0]);
    expect(steer).toMatchObject({ eventType: 'steer', itemUid, authorType: 'unverified' });
    expect(steer!.payload.message).toMatch(/^About ".*validateCreateUser.*": Keep the old signature until checkout-fix has moved its callers\.$/);
  });

  test('each agent in either workstream reads it once, on its next call; the agent in exports never does', async () => {
    const toCaller = await ordinaryCall(caller);
    expect(toCaller).toContain(BLOCK);
    expect(toCaller).toContain(`About high contract ${signalId}:`);
    expect(toCaller).toContain('From sent through the local API, not verified as the person:');
    expect(toCaller).toContain(`> ${WORDS}`);
    expect(toCaller.indexOf(BLOCK)).toBeGreaterThan(0); // after the tool's own answer
    expect(await ordinaryCall(caller)).not.toContain(BLOCK);

    expect(await ordinaryCall(changer)).toContain(`> ${WORDS}`);
    expect(await ordinaryCall(changer)).not.toContain(BLOCK);

    for (let i = 0; i < 2; i++) expect(await ordinaryCall(bystander)).not.toContain(BLOCK);
  });

  test('the tab lists the message and who has read it', async () => {
    const s = (await signals()).find((x) => x.id === signalId)!;
    expect(s.replies).toHaveLength(1);
    expect(s.replies![0]).toMatchObject({ message: WORDS, by: { actorType: 'unverified' } });
    expect(s.replies![0].readBy.map((r) => r.agentType).sort()).toEqual(['claude-code', 'codex']);
  });
});
