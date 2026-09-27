/**
 * The Presence Pane and channel threads, over REST and MCP (Phase 32 §0.4f).
 *
 * Presence: an agent posts a card, waits for the person to acknowledge it
 * or to type a reply, and dismisses the pane. Channels: a thread read back
 * in order, and an event's status changed by a person or dismissed by an
 * agent. Four routes and four tools had no test.
 *
 * Writing it found bug 25: waiting on the pane could strand an agent. A
 * second agent's question silently replaced the first agent's wait, which
 * then sat out its whole timeout; dismissing the pane left every
 * `await_ack` waiting too; and waiting on a card that does not exist waited
 * the full timeout instead of saying so.
 *
 * And bug 26, the cdev-channels flake from 0.4a: a teammate's first channel
 * event on a shared plan arrives by pull as a new `channels/` folder with
 * the file already in it. The watcher missed a file written into a folder
 * it had not yet attached to (about one in six in a probe), so the event
 * did not appear until something else touched that plan.
 */

import { test, expect } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';
import { parse as parseYaml, stringify as stringifyYaml } from 'yaml';
import { setupHarness, waitFor, openEventStream, type Harness, type ScriptedAgent, type EventStream } from '../harness';

test.describe.serial('Presence and channels', () => {
  test.setTimeout(120_000);

  let h: Harness;
  let agent: ScriptedAgent;
  let other: ScriptedAgent;
  let events: EventStream;
  let planUid: string;

  const req = async (method: string, url: string, body?: unknown) => {
    const res = await h.client.raw(method, url, body);
    expect(res.ok, `${method} ${url}: ${res.status} ${await res.clone().text()}`).toBe(true);
    return res.json();
  };
  const json = async (a: ScriptedAgent, name: string, args: Record<string, unknown>) => {
    const res = await a.callTool(name, args);
    expect(res.isError, `${name}: ${res.text}`).not.toBe(true);
    return JSON.parse(res.text);
  };
  const cards = () => req('GET', '/api/presence/cards') as Promise<Array<{ id: string; text: string; acked: boolean; ackedVia: string | null; agentId: string | null }>>;

  test.beforeAll(async () => {
    h = await setupHarness('presence-channels');
    await h.client.scanProject(h.fixture.projectPath);
    agent = await h.spawnAgent({ agentType: 'claude-desktop' });
    other = await h.spawnAgent({ agentType: 'codex' });
    events = await openEventStream(h.backend);
    planUid = (await h.client.createPlan({ title: 'Channels', projectPath: h.fixture.projectPath })).uid;
  });

  test.afterAll(async () => {
    await events?.close();
    await h?.teardown();
  });

  // ── Presence ─────────────────────────────────────────────────────────

  test('a card is posted, listed and broadcast; a person acknowledges it and the waiting agent goes on', async () => {
    const { card_id } = await json(agent, 'present', { text: 'Step 1: the **ledger** loader', require_ack: true, tone: 'question' });
    expect((await events.waitFor('presence-card', (p) => p.card.id === card_id)).card.text).toBe('Step 1: the **ledger** loader');
    expect((await cards()).find((c) => c.id === card_id)).toMatchObject({ acked: false, agentId: expect.any(String) });

    const waiting = json(agent, 'await_ack', { card_id, timeout_ms: 20_000 });
    await new Promise((r) => setTimeout(r, 200));
    await req('POST', '/api/presence/ack', { cardId: card_id, via: 'click' });
    expect(await waiting).toEqual({ acked: true, via: 'click', card_id });
    await events.waitFor('presence-acked', (p) => p.cardId === card_id);

    // Already acknowledged: answered at once.
    const started = Date.now();
    expect(await json(agent, 'await_ack', { card_id })).toEqual({ acked: true, via: 'click', card_id });
    expect(Date.now() - started).toBeLessThan(2000);
  });

  test('ack is refused without its fields and for a card that does not exist', async () => {
    expect((await h.client.raw('POST', '/api/presence/ack', { cardId: 'x' })).status).toBe(400);
    expect((await h.client.raw('POST', '/api/presence/ack', { cardId: 'pc-none', via: 'click' })).status).toBe(404);
  });

  test('waiting on a card that does not exist says so at once (bug 25)', async () => {
    const started = Date.now();
    const res = await agent.callTool('await_ack', { card_id: 'pc-none', timeout_ms: 10_000 });
    expect(Date.now() - started).toBeLessThan(3000);
    expect(res.isError).toBe(true);
    expect(res.text).toMatch(/No presence card pc-none/);
  });

  test('a typed reply reaches the waiting agent, once', async () => {
    const waiting = json(agent, 'await_user_input', { prompt: 'Which region first?', timeout_ms: 20_000 });
    await events.waitFor('presence-input-prompt', (p) => p.prompt === 'Which region first?');
    const posted = await req('POST', '/api/presence/reply', { text: 'EMEA' });
    expect(posted.reply.text).toBe('EMEA');
    expect(await waiting).toMatchObject({ text: 'EMEA' });
    await events.waitFor('presence-reply', (p) => p.reply.text === 'EMEA');

    // The answered reply is not handed to the next question as well.
    expect(await json(agent, 'await_user_input', { timeout_ms: 500 })).toEqual({ text: null, timed_out: true });
    expect((await h.client.raw('POST', '/api/presence/reply', {})).status).toBe(400);
  });

  test('a second agent\'s question replaces the first\'s, and the first is told at once (bug 25)', async () => {
    const first = json(agent, 'await_user_input', { prompt: 'Ship it?', timeout_ms: 30_000 });
    await events.waitFor('presence-input-prompt', (p) => p.prompt === 'Ship it?');
    const started = Date.now();
    const second = json(other, 'await_user_input', { prompt: 'Which branch?', timeout_ms: 30_000 });
    await events.waitFor('presence-input-prompt', (p) => p.prompt === 'Which branch?');

    // The box now asks the second question; the first agent is not left waiting.
    const superseded = await first;
    expect(Date.now() - started).toBeLessThan(5000);
    expect(superseded).toMatchObject({ text: null, superseded: true });

    await req('POST', '/api/presence/reply', { text: 'main' });
    expect(await second).toMatchObject({ text: 'main' });
  });

  test('dismissing the pane clears every card and releases anyone waiting on one (bug 25)', async () => {
    const { card_id } = await json(agent, 'present', { text: 'Step 2', require_ack: true });
    const waiting = json(agent, 'await_ack', { card_id, timeout_ms: 30_000 });
    await new Promise((r) => setTimeout(r, 200));
    const started = Date.now();
    await json(other, 'dismiss_presence', {});
    expect(await waiting).toEqual({ acked: false, via: 'dismissed', card_id });
    expect(Date.now() - started).toBeLessThan(5000);
    expect(await cards()).toEqual([]);
    await events.waitFor('presence-dismissed');
  });

  // ── Channels ─────────────────────────────────────────────────────────

  test('a thread reads back root first, then replies in order, however it was posted', async () => {
    const root = await json(agent, 'post_channel_event', { plan_uid: planUid, event_type: 'need-decision', message: 'Restate EMEA?' });
    const byPerson = await req('POST', `/api/plans/${planUid}/channels`, { event_type: 'steer', message: 'Yes, use the restated file', responds_to: root.uid });
    const byAgent = await json(agent, 'post_channel_event', { plan_uid: planUid, event_type: 'weigh-in', message: 'Done', responds_to: byPerson.uid });

    const thread = (await req('GET', `/api/channels/${root.uid}/thread`)) as Array<{ uid: string; authorType: string }>;
    expect(thread.map((e) => e.uid)).toEqual([root.uid, byPerson.uid, byAgent.uid]);
    expect(thread[1].authorType).toBe('human');

    const viaMcp = await json(agent, 'get_channel_thread', { root_event_uid: root.uid });
    expect((viaMcp.events ?? viaMcp).map((e: { uid: string }) => e.uid)).toEqual([root.uid, byPerson.uid, byAgent.uid]);
    expect(await req('GET', '/api/channels/no-such-event/thread')).toEqual([]);
  });

  test('status: a person resolves and reopens, an agent dismisses; each is broadcast; bad input refused', async () => {
    const ev = await json(agent, 'post_channel_event', { plan_uid: planUid, event_type: 'need-context', message: 'Which ledger?' });

    expect((await req('POST', `/api/channels/${ev.uid}/status`, { status: 'resolved' })).status).toBe('resolved');
    await events.waitFor('channel-event-status-changed', (p) => p.uid === ev.uid && p.status === 'resolved');
    expect((await req('POST', `/api/channels/${ev.uid}/status`, { status: 'open' })).status).toBe('open');

    const dismissed = await json(other, 'dismiss_channel_event', { event_uid: ev.uid });
    expect(dismissed.status).toBe('dismissed');
    await events.waitFor('channel-event-status-changed', (p) => p.uid === ev.uid && p.status === 'dismissed');
    const open = await json(agent, 'list_channel_events', { plan_uid: planUid, status: ['open'] });
    expect((open.events ?? open).map((e: { uid: string }) => e.uid)).not.toContain(ev.uid);

    expect((await h.client.raw('POST', `/api/channels/${ev.uid}/status`, {})).status).toBe(400);
    expect((await h.client.raw('POST', `/api/channels/${ev.uid}/status`, { status: 'closed-ish' })).status).toBe(400);
    expect((await h.client.raw('POST', '/api/channels/no-such-event/status', { status: 'resolved' })).status).toBe(404);
    expect((await other.callTool('dismiss_channel_event', { event_uid: 'no-such-event' })).isError).toBe(true);
  });

  test('a teammate\'s first channel event, pulled as a new channels/ folder, is imported (bug 26)', async () => {
    const root = h.fixture.projectPath;
    const plansDir = path.join(root, '.codetrellis', 'plans');
    const dirOf = (uid: string) => fs.readdirSync(plansDir).find((d) => {
      try { return parseYaml(fs.readFileSync(path.join(plansDir, d, 'plan.yaml'), 'utf-8'))?.uid === uid; } catch { return false; }
    });

    // Shared plans with no channel events yet: no channels/ folder on disk.
    const plans: Array<{ uid: string; dir: string }> = [];
    for (let i = 0; i < 8; i++) {
      const made = await json(agent, 'create_plan', { title: `Shared plan ${i}`, project_path: root });
      expect(made.exported).toBe(true);
      const dir = dirOf(made.uid)!;
      expect(fs.existsSync(path.join(plansDir, dir, 'channels'))).toBe(false);
      plans.push({ uid: made.uid, dir });
    }
    // Let the watcher settle on the new plan folders.
    await new Promise((r) => setTimeout(r, 1500));

    // What a pull writes: the folder, then its files, back to back.
    const arrived = plans.flatMap(({ uid, dir }, i) => {
      const channels = path.join(plansDir, dir, 'channels');
      fs.mkdirSync(channels);
      return [0, 1, 2].map((n) => {
        const eventUid = `pulled-${i}-${n}-${Date.now()}`;
        fs.writeFileSync(path.join(channels, `${eventUid}.yaml`), stringifyYaml({
          uid: eventUid, itemUid: null, eventType: 'weigh-in', payload: { message: `From a teammate, plan ${i}, #${n}` },
          author: 'teammate@example.com', authorType: 'human', agentModel: null, respondsTo: null, status: 'open',
          createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
        }));
        return { planUid: uid, eventUid };
      });
    });

    for (const { planUid, eventUid } of arrived) {
      await waitFor(async () => {
        const listed = JSON.parse((await agent.callTool('list_channel_events', { plan_uid: planUid })).text) as Array<{ uid: string }>;
        return listed.some((e) => e.uid === eventUid);
      }, { timeoutMs: 8000, description: `${eventUid} imported` });
    }
  });
});
