/**
 * M4 "done when" (Phase 32 A4.6, awareness spec §10): a contract signal on the
 * desktop reaches the phone as a push; the phone reads it and replies; the
 * reply reaches the agent as a steer on its next step.
 *
 * Journey C2 from start to end, on the running backend with real worktrees:
 *
 *   1. Sam is out. Their phone is paired and asleep: its link to the desktop
 *      is closed, and the desktop holds only its push token.
 *   2. billing-v2's agent changes `validateCreateUser`, which checkout-fix's
 *      work imports. No window is open to ask: the watchers open a high
 *      contract signal, and the asleep phone is pushed once, with the
 *      signal's id and words that name nothing.
 *   3. Sam opens the phone. It opens the signal by that id and reads both
 *      sides in plain words.
 *   4. Sam replies from the phone. The words are the person's, from their
 *      phone. They are kept beside the signal, and posted as a steer on the
 *      plan of the task checkout-fix's agent holds.
 *   5. checkout-fix's agent reads them on its next call, once, and finds the
 *      steer on its task. billing-v2's agent reads them too.
 *
 * The harness phone cannot yet reconnect with its pairing secret, so Sam
 * "opening the phone" is a second pairing: the desktop sees a second device.
 * What it proves is unchanged: the push carries only the id, and everything
 * the phone shows is loaded over the mesh from that id.
 */

import { test, expect } from '@playwright/test';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import type { AddressInfo } from 'node:net';
import { setupHarness, createMcpClient, pairPhone, type Harness, type ScriptedMcp, type Phone } from '../harness';

interface Push { to: string; title: string; body: string; data: Record<string, string> }
interface SignalDetail {
  id: string; kind: string; severity: string; heading: string;
  sideWords: Array<{ name: string; words: string }>; files: string[];
  replies: Array<{ message: string; by: { channel: string; actorType: string } }>;
}
interface ChannelEvent { uid: string; eventType: string; itemUid: string | null; payload: { message: string }; authorType: string }

const VALIDATORS = 'packages/shared/src/validators.ts';
const USER_LIST = 'packages/web/src/UserList.tsx';
const WORDS = 'Keep the old signature until checkout-fix has moved its callers.';
const BLOCK = '── CodeTrellis: a message about other work ──';
const ENV = { ...process.env, GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@x', GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@x' };

test.describe.serial('M4: away from the desk', () => {
  test.setTimeout(200_000);

  let h: Harness;
  let root: string;
  let billing: string;
  let checkout: string;
  let changer: ScriptedMcp; // billing-v2
  let caller: ScriptedMcp; // checkout-fix, holds a task
  let asleep: Phone;
  let phone: Phone;
  let receiver: http.Server;
  let planUid: string;
  let itemUid: string;
  let pushedId: string;
  const pushes: Push[] = [];

  const raw = (method: string, url: string, body?: unknown) => h.client.raw(method, url, body);
  const edit = (folder: string, rel: string, from: string, to: string) => {
    const f = path.join(folder, rel);
    const was = fs.readFileSync(f, 'utf-8');
    expect(was.includes(from), `${rel} contains the text to change`).toBe(true);
    fs.writeFileSync(f, was.replace(from, to));
  };
  const nextCall = async (agent: ScriptedMcp) => {
    const r = await agent.callTool('list_plans', {});
    expect(r.isError, r.text).toBeFalsy();
    return r.text;
  };

  test.beforeAll(async () => {
    receiver = http.createServer((req, res) => {
      let body = '';
      req.on('data', (c) => { body += c; });
      req.on('end', () => {
        try { pushes.push(...(JSON.parse(body) as Push[])); } catch { /* not a push */ }
        res.writeHead(200, { 'content-type': 'application/json' }).end('{"data":[]}');
      });
    });
    await new Promise<void>((r) => receiver.listen(0, '127.0.0.1', () => r()));
    const port = (receiver.address() as AddressInfo).port;

    h = await setupHarness('awareness-m4', {
      env: { CODETRELLIS_WORKSTREAM_DEBOUNCE_MS: '150', CODETRELLIS_PUSH_URL: `http://127.0.0.1:${port}/push` },
    });
    root = h.fixture.projectPath;
    billing = `${root}-billing`;
    checkout = `${root}-checkout`;
    for (const [dir, branch] of [[billing, 'billing-v2'], [checkout, 'checkout-fix']]) {
      execFileSync('git', ['-C', root, 'worktree', 'add', '-q', dir, '-b', branch], { env: ENV });
    }
    await h.client.scanProject(root);
    const mcp = (clientName: string, dir: string) => createMcpClient({ mcpPort: h.backend.mcpPort, capabilityToken: h.backend.capabilityToken, clientName, roots: [dir] });
    changer = mcp('claude-code', billing);
    caller = mcp('codex', checkout);
    await changer.connect();
    await caller.connect();

    // checkout-fix's agent holds a task, and its work imports the function.
    planUid = (await h.client.createPlan({ title: 'Checkout', projectPath: root })).uid;
    itemUid = ((await (await raw('POST', `/api/plans/${planUid}/items`, { kind: 'action', title: 'Signup form' })).json()) as { uid: string }).uid;
    const claimed = await caller.callTool('claim_item', { uid: itemUid });
    expect(claimed.isError, claimed.text).toBeFalsy();
    edit(checkout, USER_LIST, "import { validateCreateUser } from '@sample/shared';", "import { validateCreateUser } from '@sample/shared';\n// checkout-fix: the signup form");

    // Sam's phone: paired, its push token given, then put to sleep.
    asleep = await pairPhone(h.client, { alias: 'Sam’s phone' });
    expect((await raw('POST', '/api/peers/push-tokens', { fingerprint: asleep.fingerprint, token: 'ExponentPushToken[sam]' })).ok).toBe(true);
    await asleep.close();
    // Asleep as the desktop sees it: a phone that stops answering is let go
    // after three missed heartbeats (webrtc-service), up to ~40 s.
    await expect.poll(async () => {
      const conns = (await (await raw('GET', '/api/peers/connections')).json()) as Array<{ fingerprint: string; state: string }>;
      return conns.find((c) => c.fingerprint === asleep.fingerprint)?.state ?? 'gone';
    }, { timeout: 60_000, intervals: [1_000] }).not.toBe('connected');

    // The window showed the strip once, which starts the watchers. Then it closed.
    expect((await raw('GET', `/api/workstreams?project=${encodeURIComponent(root)}`)).ok).toBe(true);
  });

  test.afterAll(async () => {
    await phone?.close().catch(() => {});
    for (const a of [changer, caller]) await a?.disconnect().catch(() => {});
    for (const w of [billing, checkout]) {
      try { execFileSync('git', ['-C', root, 'worktree', 'remove', '--force', w]); } catch { /* */ }
    }
    await h?.teardown();
    await new Promise<void>((r) => receiver?.close(() => r()));
  });

  test('1–2. a contract opens with no window asking, and the asleep phone is pushed once: the id, and words naming nothing', async () => {
    edit(billing, VALIDATORS, 'validateCreateUser(payload: CreateUserPayload)', 'validateCreateUser(payload: CreateUserPayload, strict: boolean)');
    await expect.poll(() => pushes.length, { timeout: 20_000, intervals: [300] }).toBe(1);
    expect(pushes[0]).toMatchObject({
      to: 'ExponentPushToken[sam]',
      title: 'Needs you',
      body: 'An exported function another line of work uses has changed.',
      data: { type: 'signal' },
    });
    expect(JSON.stringify(pushes[0])).not.toMatch(/validateCreateUser|validators|billing|checkout|codex|claude/i);
    pushedId = pushes[0].data.id;
    expect(pushedId).toBeTruthy();
    // Clear the notice each agent gets anyway, so what the agents read later is the reply.
    await nextCall(caller);
    await nextCall(changer);
  });

  test('3. Sam opens the phone: it opens the signal by the pushed id, both sides in plain words', async () => {
    phone = await pairPhone(h.client, { alias: 'Sam’s phone, opened' });
    expect(phone.state().openSignals).toBe(1);
    const { signal } = await phone.rpc<{ signal: SignalDetail }>('awareness.signal', { id: pushedId });
    expect(signal).toMatchObject({ id: pushedId, kind: 'contract', severity: 'high', heading: 'Changed signature' });
    expect(signal.sideWords.map((s) => s.words)).toEqual([
      `billing-v2 changed validateCreateUser's signature in ${VALIDATORS}: validateCreateUser(payload: CreateUserPayload): string[] is now validateCreateUser(payload: CreateUserPayload, strict: boolean): string[].`,
      `checkout-fix imports it, in 1 file: ${USER_LIST}.`,
    ]);
    expect(signal.files).toEqual([VALIDATORS, USER_LIST]);
    expect(signal.replies).toEqual([]);
  });

  test('4. Sam replies from the phone: the person\'s words, kept beside the signal and posted as a steer on the held task', async () => {
    const sent = await phone.rpc<{ reply: { message: string; by: { channel: string; actorType: string } }; steers: number; signal: SignalDetail }>(
      'awareness.reply', { id: pushedId, message: WORDS },
    );
    expect(sent.reply).toMatchObject({ message: WORDS, by: { channel: 'phone', actorType: 'human' } });
    expect(sent.steers).toBe(1);
    expect(sent.signal.replies).toHaveLength(1);

    const steers = (await (await raw('GET', `/api/plans/${planUid}/channels`)).json()) as ChannelEvent[];
    const steer = steers.find((e) => e.eventType === 'steer');
    expect(steer).toMatchObject({ itemUid, authorType: 'human' });
    expect(steer!.payload.message).toMatch(/^About ".*validateCreateUser.*": Keep the old signature until checkout-fix has moved its callers\.$/);
  });

  test('5. checkout-fix\'s agent reads it on its next call, once, and finds the steer on its task; billing-v2\'s agent reads it too', async () => {
    const next = await nextCall(caller);
    expect(next).toContain(BLOCK);
    expect(next).toContain(`About high contract ${pushedId}:`);
    expect(next).toContain('From the person, from their phone:');
    expect(next).toContain(`> ${WORDS}`);
    expect(await nextCall(caller)).not.toContain(BLOCK);

    const onTask = await caller.callTool('list_channel_events', { plan_uid: planUid, item_uid: itemUid, event_types: ['steer'] });
    expect(onTask.isError, onTask.text).toBeFalsy();
    const events = JSON.parse(onTask.answer) as ChannelEvent[];
    expect(events).toHaveLength(1);
    expect(events[0].payload.message).toContain(WORDS);

    expect(await nextCall(changer)).toContain(`> ${WORDS}`);

    // The desktop shows who has read it.
    const desk = (await (await raw('GET', `/api/awareness?fresh=1&project=${encodeURIComponent(root)}`)).json()) as {
      signals: Array<{ id: string; replies?: Array<{ readBy: Array<{ agentType: string }> }> }>;
    };
    const readers = desk.signals.find((s) => s.id === pushedId)!.replies![0].readBy.map((r) => r.agentType).sort();
    expect(readers).toEqual(['claude-code', 'codex']);
  });

  test('one push for the whole journey', () => {
    expect(pushes).toHaveLength(1);
  });
});
