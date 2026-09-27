/**
 * Channels, input requests, projects, power, diagnostics and settings from
 * the phone, over the real peer path (Phase 32 §0.4j).
 *
 * The companion-app rule again: what the person does on the phone is what
 * they would have done at the desk, so a channel message from the phone
 * goes through the desktop's own path — the same author, the same routing,
 * the same broadcast — and a project opened there opens on the desktop.
 */

import { test, expect } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';
import { setupHarness, openEventStream, pairPhone, type Harness, type Phone, type EventStream } from '../harness';

test.describe.serial('Channels, projects and the rest from the phone', () => {
  test.setTimeout(120_000);

  let h: Harness;
  let phone: Phone;
  let events: EventStream;
  let root: string;
  let second: string;
  let planUid: string;
  let rootEvent: string;

  const req = async (method: string, url: string, body?: unknown) => {
    const res = await h.client.raw(method, url, body);
    expect(res.ok, `${method} ${url}: ${res.status} ${await res.clone().text()}`).toBe(true);
    return res.json();
  };

  test.beforeAll(async () => {
    h = await setupHarness('phone-channels-projects');
    root = h.fixture.projectPath;
    await h.client.scanProject(root);
    second = `${root}-second`;
    fs.mkdirSync(path.join(second, 'src'), { recursive: true });
    fs.writeFileSync(path.join(second, 'package.json'), '{"name":"second"}\n');
    fs.writeFileSync(path.join(second, 'src', 'index.ts'), 'export const second = 2;\n');
    await req('PUT', '/api/settings', { identity: { email: 'dana@example.com' } });
    planUid = (await h.client.createPlan({ title: 'Talk', projectPath: root })).uid;
    events = await openEventStream(h.backend);
    phone = await pairPhone(h.client, { alias: 'Channels phone' });
  });

  test.afterAll(async () => {
    await phone?.close();
    await events?.close();
    await h?.teardown();
    fs.rmSync(second, { recursive: true, force: true });
  });

  // ── Channels ─────────────────────────────────────────────────────────

  test('channel.post: in the person\'s name whatever the request says, and the desktop is told', async () => {
    const posted = await phone.rpc('channel.post', { planUid, eventType: 'steer', message: 'Use the LRU cache', author: 'Somebody Else' });
    rootEvent = posted.uid;
    expect(posted).toMatchObject({ planUid, eventType: 'steer', author: 'dana@example.com', authorType: 'human' });
    expect(posted.payload.message).toBe('Use the LRU cache');
    await events.waitFor('channel-event-posted', (p) => p.uid === rootEvent);

    const reply = await phone.rpc('channel.post', { planUid, eventType: 'weigh-in', message: 'Agreed', parentUid: rootEvent });
    expect(reply.respondsTo).toBe(rootEvent);

    expect(await phone.rpcError('channel.post', { planUid, eventType: 'shout', message: 'x' })).toMatch(/Unknown channel event type/);
    expect(await phone.rpcError('channel.post', { planUid, eventType: 'steer', message: '' })).toMatch(/message/);
    expect(await phone.rpcError('channel.post', { planUid: 'no-such-plan', eventType: 'steer', message: 'x' })).toMatch(/Plan not found/);
  });

  test('reading the channel: events, one event, a thread, and what is new since a seq', async () => {
    const listed = await phone.rpc('channel.events', { planUid });
    expect(listed.map((e: { uid: string }) => e.uid)).toContain(rootEvent);
    expect(listed).toEqual(await req('GET', `/api/plans/${planUid}/channels`));
    expect(await phone.rpc('channel.events', { planUid, limit: 1 })).toHaveLength(1);

    expect(await phone.rpc('channel.get', { uid: rootEvent })).toMatchObject({ uid: rootEvent, eventType: 'steer' });
    expect(await phone.rpcError('channel.get', { uid: 'no-such-event' })).toMatch(/not found/);

    const thread = await phone.rpc('channel.thread', { rootUid: rootEvent });
    expect(thread.map((e: { payload: { message: string } }) => e.payload.message)).toEqual(['Use the LRU cache', 'Agreed']);

    const all = await phone.rpc('channel.eventsSinceSeq', { planUid, sinceSeq: 0 });
    expect(all).toMatchObject({ gap: false });
    expect(all.events.map((e: { uid: string }) => e.uid)).toContain(rootEvent);
    const caughtUp = await phone.rpc('channel.eventsSinceSeq', { planUid, sinceSeq: all.latestSeq });
    expect(caughtUp).toEqual({ events: [], latestSeq: all.latestSeq, gap: false });
    await phone.rpc('channel.post', { planUid, eventType: 'need-context', message: 'Which TTL?' });
    const delta = await phone.rpc('channel.eventsSinceSeq', { planUid, sinceSeq: all.latestSeq });
    expect(delta.events.map((e: { payload: { message: string } }) => e.payload.message)).toEqual(['Which TTL?']);
  });

  test('channel.resolve: the status changes, the desktop is told, and nonsense is refused', async () => {
    const resolved = await phone.rpc('channel.resolve', { uid: rootEvent, status: 'resolved' });
    expect(resolved).toMatchObject({ uid: rootEvent, status: 'resolved' });
    await events.waitFor('channel-event-status-changed', (p) => p.uid === rootEvent && p.status === 'resolved');
    expect(await phone.rpcError('channel.resolve', { uid: rootEvent, status: 'sorted' })).toMatch(/status/);
    expect(await phone.rpcError('channel.resolve', { uid: 'no-such-event' })).toMatch(/not found/);
  });

  // ── Input requests ───────────────────────────────────────────────────

  test('input.respond answers a peer\'s pending request, once, and refuses one that is not pending', async () => {
    // A peer's agent asks a question; this desktop holds it until a person answers.
    phone.sendControl({ method: 'user-input-request', params: { requestId: 'req-1', prompt: 'Overwrite the cache file?', options: ['yes', 'no'], planUid } });
    await expect.poll(async () => (await req('GET', '/api/peers/remote-input-requests')).count, { timeout: 5000 }).toBe(1);
    const { requests } = await req('GET', '/api/peers/remote-input-requests');
    expect(requests[0]).toMatchObject({ requestId: 'req-1', prompt: 'Overwrite the cache file?', options: ['yes', 'no'], planUid, peerFingerprint: phone.fingerprint });

    expect(await phone.rpc('input.respond', { requestId: 'req-1', response: 'no' })).toEqual({ ok: true });
    const answer = await phone.waitForControl((m) => m.method === 'user-input-response');
    // Answered on the paired phone: the person, and how it arrived (0.4k).
    expect(answer.params).toEqual({ requestId: 'req-1', response: 'no', respondedBy: { actor: 'dana@example.com', actorType: 'human', channel: 'phone' } });
    expect((await req('GET', '/api/peers/remote-input-requests')).count).toBe(0);

    // Answered already, or never asked: refused, not "ok".
    expect(await phone.rpcError('input.respond', { requestId: 'req-1', response: 'yes' })).toMatch(/No pending input request/);
    expect(await phone.rpcError('input.respond', { requestId: 'req-1' })).toMatch(/response/);

    // The desktop's own answer path, for a second request.
    phone.sendControl({ method: 'user-input-request', params: { requestId: 'req-2', prompt: 'Run the migration?' } });
    await expect.poll(async () => (await req('GET', '/api/peers/remote-input-requests')).count, { timeout: 5000 }).toBe(1);
    expect(await req('POST', '/api/peers/remote-input-requests/req-2/respond', { response: 'yes' })).toEqual({ sent: true });
    const second = await phone.waitForControl((m) => m.method === 'user-input-response' && (m.params as { requestId: string }).requestId === 'req-2');
    // Plain HTTP cannot say who is behind it: unverified, on the local API (0.4d).
    expect((second.params as { respondedBy: unknown }).respondedBy).toEqual({ actor: 'dana@example.com', actorType: 'unverified', channel: 'local-api' });
    expect((await h.client.raw('POST', '/api/peers/remote-input-requests/req-2/respond', { response: 'yes' })).status).toBe(404);
    expect((await h.client.raw('POST', '/api/peers/remote-input-requests/req-3/respond', {})).status).toBe(400);
  });

  // ── Projects ─────────────────────────────────────────────────────────

  test('project.active and project.list describe what the desktop has open', async () => {
    expect(await phone.rpc('project.active')).toMatchObject({ path: root, displayName: path.basename(root) });
    const list = await phone.rpc('project.list');
    expect(list.map((p: { path: string }) => p.path)).toEqual((await req('GET', '/api/recent-projects')).projects.map((p: { path: string }) => p.path));
    expect(list.map((p: { path: string }) => p.path)).toContain(root);
  });

  test('project.open opens a folder on the desktop too; pin, alias, rescan, close and remove act on it', async () => {
    const opened = await phone.rpc('project.open', { projectPath: second }, 60_000);
    expect(opened.fileCount).toBeGreaterThan(0);
    await events.waitFor('ui-open-project', (p) => p.path === second);
    expect((await phone.rpc('project.list')).map((p: { path: string }) => p.path)).toContain(second);

    expect(await phone.rpc('project.pin', { projectPath: second })).toMatchObject({ path: second, pinned: true });
    expect(await phone.rpc('project.pin', { projectPath: second, pinned: false })).toMatchObject({ pinned: false });
    expect(await phone.rpc('project.alias', { projectPath: second, alias: 'The other one' })).toMatchObject({ path: second, displayName: 'The other one' });

    fs.writeFileSync(path.join(second, 'src', 'extra.ts'), 'export const extra = 3;\n');
    const rescanned = await phone.rpc('project.rescan', { projectPath: second }, 60_000);
    expect(rescanned.fileCount).toBe(opened.fileCount + 1);
    expect(await phone.rpcError('project.rescan', { projectPath: '/etc' })).toMatch(/not|trusted|opened/i);

    expect(await phone.rpc('project.close', { projectPath: second })).toEqual({ ok: true });
    await events.waitFor('ui-close-project', (p) => p.path === second);

    expect(await phone.rpc('project.remove', { projectPath: second })).toEqual({ ok: true });
    expect((await phone.rpc('project.list')).map((p: { path: string }) => p.path)).not.toContain(second);
    for (const method of ['project.pin', 'project.alias', 'project.remove']) {
      expect(await phone.rpcError(method, { projectPath: second, alias: 'x' }), method).toMatch(/not a recent project/);
    }
    expect(await phone.rpcError('project.open', { projectPath: path.join(second, 'no-such-dir') })).toMatch(/not|exist|directory/i);
  });

  test('a phone without the project capability may list projects but not open or change them', async () => {
    await phone.grant(['read', 'write', 'files']);
    try {
      expect((await phone.rpc('project.list')).length).toBeGreaterThan(0);
      for (const method of ['project.open', 'project.pin', 'project.remove', 'project.rescan', 'project.close', 'project.alias']) {
        expect(await phone.rpcError(method, { projectPath: root, alias: 'x' }), method).toMatch(/does not hold the "project" capability/);
      }
    } finally {
      await phone.grant(['read', 'write', 'project', 'files']);
    }
  });

  // ── Power, diagnostics, settings ─────────────────────────────────────

  test('power.status is the desktop\'s own answer, and the snapshot carries the same', async () => {
    const status = await phone.rpc('power.status');
    expect(status).toEqual(await req('GET', '/api/power/status'));
    expect(typeof status.shouldBlock).toBe('boolean');
    expect(phone.state().powerStatus).toMatchObject({ shouldBlock: status.shouldBlock });
  });

  test('diagnostics.flush writes the phone\'s entries into the desktop log, tagged with the phone', async () => {
    const at = Date.parse('2026-09-27T10:00:00Z');
    const flushed = await phone.rpc('diagnostics.flush', {
      entries: [
        { ts: at, kind: 'rtc', text: 'ice restart', data: { attempt: 2 } },
        { ts: at + 1, kind: 'rtc', text: 42 },
        { ts: at + 2, text: 'resumed' },
      ],
    });
    // The entry whose text is not text is skipped, not written as "42".
    expect(flushed).toEqual({ wrote: 2 });
    expect(await phone.rpc('diagnostics.flush', {})).toEqual({ wrote: 0 });

    const tag = `mobile:${phone.fingerprint.slice(0, 8)}`;
    await expect.poll(() => h.backend.output(), { timeout: 5000 })
      .toContain(`[${tag}] [2026-09-27T10:00:00.000Z] [Lifecycle][rtc] ice restart {"attempt":2}`);
    expect(h.backend.output()).toContain(`[${tag}] [2026-09-27T10:00:00.002Z] [Lifecycle] resumed`);
  });

  test('settings: read with the default grants; changed only with the settings capability, and only the phone-safe part', async () => {
    const settings = await phone.rpc('settings.get');
    expect(settings).toEqual(await req('GET', '/api/settings'));
    expect(await phone.rpcError('settings.update', { identity: { name: 'x' } })).toMatch(/does not hold the "settings" capability/);

    await phone.grant(['read', 'write', 'project', 'files', 'settings']);
    try {
      const updated = await phone.rpc('settings.update', { identity: { displayName: 'Dana from the phone' }, mcp: { port: 1 }, webhooks: { allowedHosts: ['evil.test'] } });
      expect(updated.identity.displayName).toBe('Dana from the phone');
      await events.waitFor('settings-changed', (p) => p.settings?.identity?.displayName === 'Dana from the phone');
      // Ports, paths and where webhooks may go are not the phone's to change.
      const after = await req('GET', '/api/settings');
      expect(after.mcp).toEqual(settings.mcp);
      expect(after.data).toEqual(settings.data);
      expect(after.webhooks).toEqual(settings.webhooks);
    } finally {
      await phone.grant(['read', 'write', 'project', 'files']);
    }
  });
});
