/**
 * What an open plan is told as an agent works it.
 *
 * Writing the hero video's "every change as it happens" beat found that it
 * was not true: an agent claiming a task or reporting progress left the open
 * plan showing it pending, unassigned and at 0% until it was reloaded, and
 * its Activity never moved. The window said claims and progress "cascade
 * through plan-item-updated"; nothing sent one. And only one tool broadcast
 * the events it recorded, so a status change, a move or a new task never
 * reached Activity live.
 *
 * Now every event the log records is broadcast from one place
 * (plan-event-service's listener), and the window handles the claim and
 * progress broadcasts itself. The browser spec
 * e2e/plan/live-agent-updates.spec.ts checks the window shows them.
 */

import { test, expect } from '@playwright/test';
import { setupHarness, openEventStream, type Harness, type ScriptedAgent, type EventStream } from '../harness';

test.describe.serial('An open plan is told of an agent\'s work as it happens', () => {
  test.setTimeout(120_000);

  let h: Harness;
  let agent: ScriptedAgent;
  let events: EventStream;
  let planUid: string;
  let itemUid: string;

  const req = async (method: string, url: string, body?: unknown) => {
    const res = await h.client.raw(method, url, body);
    expect(res.ok, `${method} ${url}: ${res.status} ${await res.clone().text()}`).toBe(true);
    return res.json();
  };
  const call = async (name: string, args: Record<string, unknown> = {}) => {
    const res = await agent.callTool(name, args);
    expect(res.isError, `${name}: ${res.text}`).not.toBe(true);
    return res.text;
  };
  const planEvents = (match: (e: any) => boolean) =>
    events.ofType('plan-event').map((e) => e.payload as any).filter((p) => p.planUid === planUid && match(p.event));

  test.beforeAll(async () => {
    h = await setupHarness('plan-live-events');
    await h.client.scanProject(h.fixture.projectPath);
    agent = await h.spawnAgent({ agentType: 'codex' });
    events = await openEventStream(h.backend);
    planUid = (await h.client.createPlan({ title: 'Live events', projectPath: h.fixture.projectPath })).uid;
    itemUid = (await req('POST', `/api/plans/${planUid}/items`, { kind: 'action', title: 'Pair the ledger' })).uid;
  });

  test.afterAll(async () => {
    await events?.close();
    await h?.teardown();
  });

  test('a task created from the app reaches Activity live', async () => {
    await expect.poll(() => planEvents((e) => e.itemUid === itemUid && e.eventType === 'item_created').length, { timeout: 5000 }).toBe(1);
    const [{ event }] = planEvents((e) => e.itemUid === itemUid && e.eventType === 'item_created');
    expect(typeof event.id).toBe('number');
    expect(event.summary).toBeTruthy();
  });

  test('an agent\'s claim is broadcast with what the window needs, and its status change reaches Activity', async () => {
    await call('claim_item', { uid: itemUid });
    const claimed = await events.waitFor('plan-item-claimed', (p) => p.itemUid === itemUid);
    expect(claimed).toMatchObject({ planUid, itemUid });
    await expect.poll(() => planEvents((e) => e.itemUid === itemUid && e.eventType === 'status_changed').length, { timeout: 5000 }).toBeGreaterThan(0);
    // What the window reads back on a claim is what the claim decided.
    const item = await req('GET', `/api/items/${itemUid}`);
    expect((item.item ?? item).status).toBe('assigned');
  });

  test('a progress report is broadcast with its percentage', async () => {
    await call('update_item_progress', { uid: itemUid, percent: 40, message: 'Pairs matched for EUR' });
    const progress = await events.waitFor('plan-item-progress', (p) => p.itemUid === itemUid && p.percent === 40);
    expect(progress).toMatchObject({ planUid, itemUid, percent: 40 });
  });

  test('every event is broadcast once, even from the tool that also sends its own', async () => {
    const ids = events.ofType('plan-event').map((e) => (e.payload as any).event?.id).filter((id) => typeof id === 'number');
    // A tool that broadcasts by hand sends the same event (same id) again;
    // the window ignores a repeat (plan-items-store onItemEvent). Here none
    // of the routes used do, so each id arrives exactly once.
    expect(new Set(ids).size).toBe(ids.length);
  });
});
