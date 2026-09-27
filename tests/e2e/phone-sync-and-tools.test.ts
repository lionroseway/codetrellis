/**
 * What the desktop pushes to a phone, and what an agent can do with one
 * (Phase 32 §0.4j).
 *
 *   - `ui`: a snapshot on connect, then JSON patches. The phone never asks
 *     for most of what it shows — it applies patches — so a patch that does
 *     not land is a stale screen.
 *   - `terminal`: the raw relay of local terminals. It has to answer to the
 *     same `terminal` grant as the RPC methods; it did not (bug 41).
 *   - the `mobile_*` MCP tools, which drive the phone.
 *   - the peer REST routes the desktop's Devices panel reads.
 *   - approvals and budget, over the real path (their handlers have unit tests).
 */

import { test, expect } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';
import { setupHarness, openEventStream, pairPhone, type Harness, type Phone, type EventStream, type ScriptedAgent } from '../harness';

test.describe.serial('Sync, the terminal relay, and agent tools on the phone', () => {
  test.setTimeout(120_000);

  let h: Harness;
  let phone: Phone;
  let agent: ScriptedAgent;
  let events: EventStream;
  let root: string;
  let planUid: string;

  const req = async (method: string, url: string, body?: unknown) => {
    const res = await h.client.raw(method, url, body);
    expect(res.ok, `${method} ${url}: ${res.status} ${await res.clone().text()}`).toBe(true);
    return res.json();
  };
  /** The desktop's state as a fresh snapshot would give it, for comparing with the patched one. */
  const freshSnapshot = async (p: Phone) => {
    const before = p.ui.length;
    p.sendUi({ type: 'resync-request', ts: Date.now(), sourceInstanceId: 'harness-phone' });
    await expect.poll(() => p.ui.slice(before).some((m) => m.type === 'snapshot'), { timeout: 10_000 }).toBe(true);
    return (p.ui.slice(before).find((m) => m.type === 'snapshot') as { snapshot: any }).snapshot;
  };
  const stable = (s: any) => ({ ...s, ts: 0, powerStatus: undefined, agents: undefined });

  test.beforeAll(async () => {
    h = await setupHarness('phone-sync-and-tools');
    root = h.fixture.projectPath;
    await h.client.scanProject(root);
    await h.client.grantMcpCapabilities(['read', 'write', 'project', 'capture']);
    agent = await h.spawnAgent({ agentType: 'claude-desktop' });
    events = await openEventStream(h.backend);
    phone = await pairPhone(h.client, { alias: 'Sync phone' });
  });

  test.afterAll(async () => {
    await phone?.close();
    await events?.close();
    await h?.teardown();
  });

  // ── The ui channel ───────────────────────────────────────────────────

  test('the first snapshot describes the desktop: the open project, its plans, the power state', async () => {
    const state = phone.state();
    expect(state.v).toBe(2);
    expect(state.activeProject).toMatchObject({ path: root });
    expect(state.recentProjects.map((p: { path: string }) => p.path)).toContain(root);
    expect(state.powerStatus).toEqual(await req('GET', '/api/power/status'));
  });

  test('a change on the desktop arrives as a patch, and the patched state matches a fresh snapshot', async () => {
    planUid = (await h.client.createPlan({ title: 'Patched in', projectPath: root })).uid;
    await phone.waitForState((s) => s.plans.some((p: { uid: string }) => p.uid === planUid));
    expect(phone.ui.some((m) => m.type === 'patch')).toBe(true);

    await req('PUT', `/api/plans/${planUid}`, { title: 'Patched in, renamed' });
    await phone.waitForState((s) => s.plans.find((p: { uid: string }) => p.uid === planUid)?.name === 'Patched in, renamed');
    expect(stable(phone.state())).toEqual(stable(await freshSnapshot(phone)));
  });

  test('nothing changing, nothing sent (bug 42)', async () => {
    // `ts` changed on every 100 ms collection and counted as a change, so
    // every phone got ten empty patches a second for as long as it was
    // connected.
    await new Promise((r) => setTimeout(r, 500));
    const before = phone.ui.length;
    await new Promise((r) => setTimeout(r, 1500));
    expect(phone.ui.slice(before).filter((m) => m.type === 'patch')).toEqual([]);
  });

  test('a second phone connecting does not leave the first one behind (bug 42)', async () => {
    const second = await pairPhone(h.client, { alias: 'Second phone' });
    try {
      // A change, then at once the other phone asks for a snapshot. The base
      // patches were computed from was shared, and the snapshot reset it, so
      // the first phone was never sent the change.
      for (let i = 1; i <= 3; i++) {
        await req('PUT', `/api/plans/${planUid}`, { title: `Race ${i}` });
        second.sendUi({ type: 'resync-request', ts: Date.now(), sourceInstanceId: 'harness-phone-2' });
      }
      await phone.waitForState((s) => s.plans.find((x: { uid: string }) => x.uid === planUid)?.name === 'Race 3', 5000);
      await req('PUT', `/api/plans/${planUid}`, { title: 'Seen by both' });
      for (const p of [phone, second]) {
        await p.waitForState((s) => s.plans.find((x: { uid: string }) => x.uid === planUid)?.name === 'Seen by both')
          .catch((e) => { throw new Error(`${p.alias}: ${e.message}; sees ${JSON.stringify(p.state().plans.map((x: { name: string }) => x.name))}; last ui ${JSON.stringify(p.ui.slice(-3)).slice(0, 200)}`); });
      }
      expect(stable(phone.state())).toEqual(stable(await freshSnapshot(phone)));
      expect(stable(second.state())).toEqual(stable(await freshSnapshot(second)));
    } finally {
      await second.close();
    }
  });

  test('a peer\'s own snapshot is kept as its remote state, for the desktop\'s device view', async () => {
    const mine = { ...phone.state(), ts: Date.now(), plans: [], activeProject: null, deviceAddresses: ['10.0.0.9'] };
    phone.sendUi({ type: 'snapshot', snapshot: mine, ts: Date.now(), sourceInstanceId: 'harness-phone' });
    await expect.poll(async () => (await h.client.raw('GET', `/api/peers/remote-state/${encodeURIComponent(phone.fingerprint)}`)).status, { timeout: 5000 }).toBe(200);
    expect((await req('GET', `/api/peers/remote-state/${encodeURIComponent(phone.fingerprint)}`)).deviceAddresses).toEqual(['10.0.0.9']);
    const all = await req('GET', '/api/peers/remote-state');
    expect(JSON.stringify(all)).toContain(phone.fingerprint);
    expect((await h.client.raw('GET', '/api/peers/remote-state/no-such-peer')).status).toBe(404);
  });

  // ── The terminal relay ───────────────────────────────────────────────

  test('without the terminal grant the relay sends the phone nothing and takes nothing from it (bug 41)', async () => {
    const shell = await req('POST', '/api/terminals', { preset: 'shell', title: 'Private', cwd: root });
    const marker = path.join(root, 'relay-pwned.txt');
    await req('POST', `/api/terminals/${shell.id}/inject`, { text: 'echo secret-$((20+22))\n' });
    await expect.poll(async () => (await req('GET', `/api/terminals/${shell.id}/history`)).data, { timeout: 15_000 }).toContain('secret-42');
    await new Promise((r) => setTimeout(r, 500));
    expect(phone.terminal.map((b) => b.toString('utf-8')).join(''), 'terminal output reached a phone without the grant').not.toContain('secret-42');

    // Typing into index 0 over the raw channel, as the phone's terminal screen does.
    phone.sendTerminal(Buffer.concat([Buffer.from([0x03, 0x00]), Buffer.from(`touch ${marker}\n`)]));
    await new Promise((r) => setTimeout(r, 1500));
    expect(fs.existsSync(marker), 'a phone without the grant ran a command').toBe(false);
    const refused = (await req('GET', `/api/peers/audit?fingerprint=${encodeURIComponent(phone.fingerprint)}`));
    const entries = Array.isArray(refused) ? refused : refused.entries;
    expect(entries.some((e: { kind: string; method: string }) => e.kind === 'refused' && /terminal/.test(e.method))).toBe(true);

    // Granted: the list, the output and the input all flow, and are audited.
    await phone.grant(['read', 'write', 'project', 'files', 'terminal']);
    await req('POST', `/api/terminals/${shell.id}/inject`, { text: 'echo granted-$((1+1))\n' });
    await expect.poll(() => phone.terminal.map((b) => b.toString('utf-8')).join(''), { timeout: 15_000 }).toContain('granted-2');
    phone.sendTerminal(Buffer.concat([Buffer.from([0x03, 0x00]), Buffer.from(`touch ${marker}\n`)]));
    await expect.poll(() => fs.existsSync(marker), { timeout: 15_000 }).toBe(true);
    const after = await req('GET', `/api/peers/audit?fingerprint=${encodeURIComponent(phone.fingerprint)}`);
    expect((Array.isArray(after) ? after : after.entries).some((e: { kind: string; method: string }) => e.kind === 'terminal-access' && /terminal/.test(e.method))).toBe(true);
    await phone.grant(['read', 'write', 'project', 'files']);
    await req('DELETE', `/api/terminals/${shell.id}`);
  });

  // ── The mobile_* tools ───────────────────────────────────────────────

  test('mobile_navigate sends the phone to a view, a plan or an item; an unknown plan is refused', async () => {
    const nav = async (args: Record<string, unknown>) => {
      const before = phone.control.length;
      const res = await agent.callTool('mobile_navigate', args);
      expect(res.isError, res.text).not.toBe(true);
      expect(res.text).toMatch(/^Navigated [1-9]\d* phone\(s\) to /);
      return (await expect.poll(() => phone.control.slice(before).find((m) => m.mcp && m.cmd === 'navigate'), { timeout: 5000 }).toBeTruthy(),
        phone.control.slice(before).find((m) => m.mcp && m.cmd === 'navigate')!.route);
    };
    expect(await nav({ view: 'terminals' })).toBe('/(tabs)/terminals');
    expect(await nav({ plan_uid: planUid })).toBe(`/plan-detail?uid=${planUid}`);
    const item = await req('POST', `/api/plans/${planUid}/items`, { kind: 'action', title: 'Look here' });
    expect(await nav({ plan_uid: planUid, item_uid: item.uid })).toBe(`/item-detail?uid=${item.uid}&planUid=${planUid}`);

    for (const args of [{ plan_uid: 'no-such-plan' }, { item_uid: 'no-such-item' }]) {
      const res = await agent.callTool('mobile_navigate', args);
      expect(res.isError, JSON.stringify(args)).toBe(true);
      expect(res.text).toMatch(/not found/i);
    }
    expect((await agent.callTool('mobile_navigate', {})).isError).toBe(true);
  });

  test('mobile_screenshot returns what the phone sends, reassembled from chunks in any order', async () => {
    const png = Buffer.from('89504e470d0a1a0a-this-stands-in-for-an-image-'.repeat(30)).toString('base64');
    const parts = [png.slice(0, 400), png.slice(400, 800), png.slice(800)];
    const pending = agent.callTool('mobile_screenshot', {});
    const ask = await phone.waitForControl((m) => m.mcp === true && m.cmd === 'screenshot');
    for (const seq of [2, 0, 1]) {
      phone.sendControl({ mcp: true, cmd: 'screenshot.chunk', id: ask.id, seq, total: 3, mime: 'image/jpeg', data: parts[seq] });
    }
    const res = await pending;
    expect(res.isError, res.text).not.toBe(true);
    expect(res.content[0]).toMatchObject({ type: 'image', data: png, mimeType: 'image/jpeg' });

    // A phone that cannot take one says so, and the agent hears why.
    const failing = agent.callTool('mobile_screenshot', {});
    const ask2 = await phone.waitForControl((m) => m.mcp === true && m.cmd === 'screenshot' && m.id !== ask.id);
    phone.sendControl({ mcp: true, cmd: 'screenshot.result', id: ask2.id, error: 'view-shot not built in' });
    const failed = await failing;
    expect(failed.isError).toBe(true);
    expect(failed.text).toContain('view-shot not built in');
  });

  test('mobile_present puts a card on the phone through the snapshot', async () => {
    const res = await agent.callTool('mobile_present', { text: 'Tap **Plans** next', tone: 'question' });
    expect(res.isError, res.text).not.toBe(true);
    expect(JSON.parse(res.text)).toMatchObject({ mobile: true });
    await phone.waitForState((s) => s.presence.some((c: { text: string }) => c.text === 'Tap **Plans** next'));
  });

  // ── Peer REST routes ─────────────────────────────────────────────────

  test('the Devices panel\'s routes: connections, discovered, remote terminals and audio, push tokens', async () => {
    const connections = await req('GET', '/api/peers/connections');
    const me = (Array.isArray(connections) ? connections : connections.connections).find((c: { fingerprint: string }) => c.fingerprint === phone.fingerprint);
    expect(me).toMatchObject({ alias: 'Sync phone', state: 'connected', deviceType: 'mobile' });
    expect(me.openChannels).toEqual(expect.arrayContaining(['control', 'ui', 'terminal', 'audio']));

    expect(Array.isArray(await req('GET', '/api/peers/discovered'))).toBe(true);
    expect(await req('GET', '/api/peers/remote-audio')).toMatchObject({ count: expect.any(Number) });

    // A peer that shares its own terminals: they show as remote terminals here.
    phone.sendTerminal(Buffer.concat([Buffer.from([0x01]), Buffer.from(JSON.stringify([{ id: 'phone-t1', preset: 'shell', title: 'On the other machine', cwd: '/x', alive: true, index: 0 }]))]));
    await expect.poll(async () => (await req('GET', '/api/peers/remote-terminals')).count, { timeout: 5000 }).toBe(1);
    expect((await req('GET', `/api/peers/remote-terminals?fingerprint=${encodeURIComponent(phone.fingerprint)}`)).terminals[0])
      .toMatchObject({ id: 'phone-t1', title: 'On the other machine', peerFingerprint: phone.fingerprint });
    const before = phone.terminal.length;
    expect(await req('POST', `/api/peers/remote-terminals/${encodeURIComponent(phone.fingerprint)}/phone-t1/write`, { data: 'ls\n' })).toEqual({ sent: true });
    await expect.poll(() => phone.terminal.slice(before).some((b) => b[0] === 0x03 && b.subarray(2).toString() === 'ls\n'), { timeout: 5000 }).toBe(true);
    expect((await h.client.raw('POST', `/api/peers/remote-terminals/${encodeURIComponent(phone.fingerprint)}/no-such-terminal/write`, { data: 'ls\n' })).status).toBe(404);
    expect((await h.client.raw('POST', `/api/peers/remote-terminals/${encodeURIComponent(phone.fingerprint)}/phone-t1/write`, {})).status).toBe(400);

    // The phone registers its push token and hears it landed.
    phone.sendControl({ method: 'register-push-token', params: { token: 'ExponentPushToken[harness]' } });
    await phone.waitForControl((m) => m.method === 'push-token-ack');
    const tokens = await req('GET', '/api/peers/push-tokens');
    expect(JSON.stringify(tokens)).toContain(phone.fingerprint);
  });

  // ── Approvals and budget, over the real path ─────────────────────────

  test('criteria awaiting a person, and deciding one from the phone', async () => {
    const [item] = await req('GET', `/api/plans/${planUid}/items`);
    const criterion = await req('POST', `/api/items/${item.uid}/criteria`, { text: 'Reads well on a phone', kind: 'manual' });
    const listed = await phone.rpc('criteria.list', { itemUid: item.uid });
    expect(listed.item.uid).toBe(item.uid);
    expect(listed.criteria.map((c: { uid: string }) => c.uid)).toContain(criterion.uid);
    // Nothing awaits a person until the agent says it is done.
    expect((await phone.rpc('criteria.awaiting', {})).entries).toEqual([]);
    const submitted = await agent.callTool('submit_criterion', { criterion_uid: criterion.uid, note: 'Checked at 375px' });
    expect(submitted.isError, submitted.text).not.toBe(true);
    const awaiting = await phone.rpc('criteria.awaiting', {});
    expect(awaiting.entries.map((e: { uid: string; planUid: string }) => [e.uid, e.planUid])).toEqual([[criterion.uid, planUid]]);

    const decided = await phone.rpc('criterion.decide', { criterionUid: criterion.uid, decision: 'approved' });
    expect(decided.criterion.uid).toBe(criterion.uid);
    expect((await phone.rpc('criteria.awaiting', {})).entries).toEqual([]);
    expect(await phone.rpcError('artefact.preview', { attachmentUid: 'no-such-attachment', transferId: 'transfer-0001' })).toMatch(/No evidence file with that uid/);
    expect(await phone.rpcError('artefact.preview', { attachmentUid: 'x', transferId: 't1' })).toMatch(/transferId must be/);
  });

  test('budget: an agent\'s change is flagged on the phone and marked seen there', async () => {
    const res = await agent.callTool('set_budget', { plan_uid: planUid, minutes: 90 });
    expect(res.isError, res.text).not.toBe(true);
    const budget = await phone.rpc('budget.get', { planUid });
    expect(budget.budget).toMatchObject({ minutes: 90 });
    expect(budget.flaggedChanges).toHaveLength(1);
    const after = await phone.rpc('budget.acknowledge', { planUid, changeId: budget.flaggedChanges[0].id });
    expect(after.flaggedChanges).toEqual([]);
    await events.waitFor('plan-budget-changed', (p) => p.planUid === planUid && p.acknowledged === budget.flaggedChanges[0].id);
  });
});
