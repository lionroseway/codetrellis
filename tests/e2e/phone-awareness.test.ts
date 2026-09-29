/**
 * Awareness on the phone (Phase 32 A4.2), end to end.
 *
 * Journey C2, away from the desk: billing-v2's agent changes a function that
 * checkout-fix's work imports. Sam's phone counts it live in the snapshot,
 * lists it in the digest's words, and opens it with both sides in plain words.
 * Sam replies from the phone ("keep the old signature until checkout-fix
 * moves its callers"). The checkout agent reads it on its next call as the
 * person's words from their phone, and the desktop lists it. Sam acknowledges
 * it from the phone: the answer is the person's (not "unverified"), from the
 * phone, audited, and the count drops.
 *
 * A phone allowed only to read sees the signal and cannot answer or reply.
 */

import { test, expect } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { setupHarness, createMcpClient, openEventStream, pairPhone, type Harness, type ScriptedMcp, type Phone, type EventStream } from '../harness';

interface PhoneSignal { id: string; kind: string; severity: string; state: string; heading: string; summary: string; sides: string[] }
interface PhoneSignalDetail extends PhoneSignal {
  sideWords: Array<{ name: string; words: string }>; files: string[];
  told: Array<{ agentType: string }>; replies: Array<{ message: string; by: { channel: string; actorType: string } }>;
  stateBy?: { actorType: string; channel: string; actor: string };
}
interface NeedsYou { projectRoot: string | null; digest: { needsYou: number; lines: Array<{ text: string; question: string }> }; signals: PhoneSignal[] }

const VALIDATORS = 'packages/shared/src/validators.ts';
const USER_LIST = 'packages/web/src/UserList.tsx';
const WORDS = 'Keep the old signature until checkout-fix has moved its callers.';
const ENV = { ...process.env, GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@x', GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@x' };

test.describe.serial('Awareness on the phone', () => {
  test.setTimeout(120_000);

  let h: Harness;
  let root: string;
  let billing: string;
  let checkout: string;
  let changer: ScriptedMcp;
  let caller: ScriptedMcp;
  let phone: Phone;
  let events: EventStream;
  let id: string;

  const raw = (method: string, url: string, body?: unknown) => h.client.raw(method, url, body);
  const edit = (folder: string, rel: string, from: string, to: string) => {
    const f = path.join(folder, rel);
    fs.writeFileSync(f, fs.readFileSync(f, 'utf-8').replace(from, to));
  };
  const ordinaryCall = async (agent: ScriptedMcp) => (await agent.callTool('list_plans', {})).text;

  test.beforeAll(async () => {
    h = await setupHarness('phone-awareness', { env: { CODETRELLIS_WORKSTREAM_DEBOUNCE_MS: '150' } });
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
    edit(checkout, USER_LIST, "import { validateCreateUser } from '@sample/shared';", "import { validateCreateUser } from '@sample/shared';\n// checkout-fix: the signup form");
    events = await openEventStream(h.backend);
    phone = await pairPhone(h.client, { alias: 'Sam’s phone' });
    // The window shows the strip once: that listing starts the workstream watchers.
    expect((await raw('GET', `/api/workstreams?project=${encodeURIComponent(root)}`)).ok).toBe(true);
  });

  test.afterAll(async () => {
    await phone?.close().catch(() => {});
    events?.close();
    for (const a of [changer, caller]) await a?.disconnect().catch(() => {});
    for (const w of [billing, checkout]) {
      try { execFileSync('git', ['-C', root, 'worktree', 'remove', '--force', w]); } catch { /* */ }
    }
    await h?.teardown();
  });

  test('nothing overlaps: the phone\'s count is 0 and its list is empty', async () => {
    expect(phone.state().openSignals).toBe(0);
    const got = await phone.rpc<NeedsYou>('awareness.needsYou');
    expect(got.projectRoot).toBe(root);
    expect(got.signals).toEqual([]);
    expect(got.digest.needsYou).toBe(0);
  });

  test('a contract change on the desktop moves the phone\'s live count, with no window asking', async () => {
    edit(billing, VALIDATORS, 'validateCreateUser(payload: CreateUserPayload)', 'validateCreateUser(payload: CreateUserPayload, strict: boolean)');
    await phone.waitForState((s) => s.openSignals === 1, 15_000);
  });

  test('the phone lists it in the digest\'s words, and opens it with both sides in plain words', async () => {
    const got = await phone.rpc<NeedsYou>('awareness.needsYou');
    expect(got.digest.needsYou).toBe(1);
    expect(got.digest.lines[0]).toMatchObject({ text: "`billing-v2` changed validateCreateUser's signature; `checkout-fix` imports it", question: 'keep the old signature, or update the callers?' });
    expect(got.signals).toHaveLength(1);
    expect(got.signals[0]).toMatchObject({ kind: 'contract', severity: 'high', state: 'open', heading: 'Changed signature', sides: ['billing-v2', 'checkout-fix'] });
    id = got.signals[0].id;

    const { signal } = await phone.rpc<{ signal: PhoneSignalDetail }>('awareness.signal', { id });
    expect(signal.sideWords.map((s) => s.words)).toEqual([
      `billing-v2 changed validateCreateUser's signature in ${VALIDATORS}: validateCreateUser(payload: CreateUserPayload): string[] is now validateCreateUser(payload: CreateUserPayload, strict: boolean): string[].`,
      `checkout-fix imports it, in 1 file: ${USER_LIST}.`,
    ]);
    expect(signal.files).toEqual([VALIDATORS, USER_LIST]);
    expect(signal.replies).toEqual([]);
    // Clear the notice each agent gets anyway, so the next call carries only the reply.
    await ordinaryCall(caller);
    await ordinaryCall(changer);
  });

  test('Sam replies from the phone: the agent reads it as the person\'s words from their phone; the desktop lists it', async () => {
    const told = events.waitFor('awareness-changed');
    const sent = await phone.rpc<{ reply: { message: string; by: { channel: string; actorType: string } }; steers: number; signal: PhoneSignalDetail }>('awareness.reply', { id, message: WORDS, actor: 'Priya' });
    expect(sent.reply).toMatchObject({ message: WORDS, by: { channel: 'phone', actorType: 'human' } });
    expect(sent.signal.replies).toHaveLength(1);
    await told;

    const text = await ordinaryCall(caller);
    expect(text).toContain('From the person, from their phone:');
    expect(text).toContain(`> ${WORDS}`);

    const desk = (await (await raw('GET', `/api/awareness?project=${encodeURIComponent(root)}`)).json()) as { signals: Array<{ id: string; replies?: Array<{ message: string; by: { channel: string; actor: string } }> }> };
    const reply = desk.signals.find((s) => s.id === id)!.replies![0];
    expect(reply).toMatchObject({ message: WORDS, by: { channel: 'phone' } });
    expect(reply.by.actor).not.toBe('Priya');
  });

  test('Sam acknowledges from the phone: the person\'s answer, from the phone, audited; the count drops', async () => {
    const { signal } = await phone.rpc<{ signal: PhoneSignalDetail }>('awareness.answer', { id, state: 'acknowledged' });
    expect(signal.state).toBe('acknowledged');
    expect(signal.stateBy).toMatchObject({ actorType: 'human', channel: 'phone' });
    await phone.waitForState((s) => s.openSignals === 0);
    // Still listed as seen, while it is true.
    expect((await phone.rpc<NeedsYou>('awareness.needsYou')).signals.map((s) => [s.id, s.state])).toEqual([[id, 'acknowledged']]);

    const audit = await (await raw('GET', `/api/peers/audit?fingerprint=${encodeURIComponent(phone.fingerprint)}`)).json() as unknown;
    const entries = (Array.isArray(audit) ? audit : (audit as { entries: Array<{ method: string; kind: string }> }).entries) as Array<{ method: string; kind: string }>;
    expect(entries.filter((e) => e.kind === 'decision').map((e) => e.method).sort()).toEqual(['awareness.answer', 'awareness.reply']);
  });

  test('refused from the phone: a state that is not one, no words, a signal that is not open', async () => {
    expect(await phone.rpcError('awareness.answer', { id, state: 'resolved' })).toMatch(/state must be one of/);
    expect(await phone.rpcError('awareness.reply', { id, message: ' ' })).toMatch(/message must be 1–1000 characters/);
    expect(await phone.rpcError('awareness.signal', { id: 'nope' })).toMatch(/No such open signal/);
  });

  test('a phone allowed only to read sees the signal, and cannot answer it or reply', async () => {
    await phone.grant(['read']);
    expect((await phone.rpc<{ signal: PhoneSignalDetail }>('awareness.signal', { id })).signal.id).toBe(id);
    expect(await phone.rpcError('awareness.answer', { id, state: 'open' })).toMatch(/write/i);
    expect(await phone.rpcError('awareness.reply', { id, message: 'hi' })).toMatch(/write/i);
  });
});
