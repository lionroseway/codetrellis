/**
 * Cross-plan dependencies (Phase 32 B6.1, bug 11).
 *
 * "Deploy exports" in the Exports plan depends on "Migrate schema" in the
 * Billing plan. Before B6.1 it was never offered, by `get_next_item` or by
 * `/next-task`, whatever Migrate's status: both looked for the dependency in
 * Exports only. Now it waits while Migrate is unfinished, everyone is told
 * what it waits on and where, and it is offered once Migrate is done. A
 * dependency that could never be met (nothing, itself, a page) is refused
 * when it is written.
 */

import { test, expect } from '@playwright/test';
import { setupHarness, type Harness } from '../harness';
import type { ScriptedAgent } from '../harness/scripted-agent';

test.describe.serial('Cross-plan dependencies', () => {
  test.setTimeout(90_000);

  let h: Harness;
  let agent: ScriptedAgent;
  let billing: string;
  let exportsPlan: string;
  let migrate: string;
  let deploy: string;
  let notes: string;

  const post = async (path: string, body: unknown) => (await h.client.raw('POST', path, body)).json() as Promise<{ uid: string }>;

  test.beforeAll(async () => {
    h = await setupHarness('cross-plan-deps');
    const root = h.fixture.projectPath;
    await h.client.scanProject(root);
    billing = (await h.client.createPlan({ title: 'Billing v2', projectPath: root })).uid;
    exportsPlan = (await h.client.createPlan({ title: 'Exports', projectPath: root })).uid;
    migrate = (await post(`/api/plans/${billing}/items`, { kind: 'action', title: 'Migrate schema' })).uid;
    notes = (await post(`/api/plans/${billing}/items`, { kind: 'object', title: 'Design notes' })).uid;
    deploy = (await post(`/api/plans/${exportsPlan}/items`, { kind: 'action', title: 'Deploy exports', dependencies: [migrate] })).uid;
    agent = await h.spawnAgent({ agentType: 'codex' });
  });

  test.afterAll(async () => { await h?.teardown(); });

  test('while the other plan\'s task is unfinished, the dependant waits, and everyone is told where', async () => {
    expect(await (await h.client.raw('GET', `/api/plans/${exportsPlan}/next-task`)).json()).toEqual({ none: true });

    const next = await agent.getNextItem(exportsPlan);
    expect(next.text).toContain('"Deploy exports" waits on "Migrate schema" in plan "Billing v2".');

    const { waits } = (await (await h.client.raw('GET', `/api/plans/${exportsPlan}/waits`)).json()) as {
      waits: Array<{ itemUid: string; sentence: string; waits: Array<{ uid: string; planUid: string; planTitle: string; problem: string }> }>;
    };
    expect(waits).toHaveLength(1);
    expect(waits[0]).toMatchObject({ itemUid: deploy, sentence: '"Deploy exports" waits on "Migrate schema" in plan "Billing v2".' });
    expect(waits[0].waits[0]).toMatchObject({ uid: migrate, planUid: billing, planTitle: 'Billing v2', problem: 'unfinished' });
  });

  test('claiming it early is allowed, with a warning naming what it waits on', async () => {
    const claim = JSON.parse((await agent.claimItem(deploy)).answer) as { message: string; waits_on: string[] };
    expect(claim.waits_on).toEqual(['waits on "Migrate schema" in plan "Billing v2"']);
    expect(claim.message).toContain('this task waits on "Migrate schema" in plan "Billing v2", which is not finished');
    // Put it back, so the next test sees an unclaimed task.
    expect((await h.client.raw('PUT', `/api/items/${deploy}`, { status: 'pending', assignee: null })).ok).toBe(true);
  });

  test('once the other plan\'s task is done, the dependant is offered by every door', async () => {
    expect((await h.client.raw('PUT', `/api/items/${migrate}`, { status: 'done' })).ok).toBe(true);

    expect(((await (await h.client.raw('GET', `/api/plans/${exportsPlan}/next-task`)).json()) as { uid: string }).uid).toBe(deploy);
    expect((JSON.parse((await agent.getNextItem(exportsPlan)).answer) as { uid: string }).uid).toBe(deploy);
    expect(((await (await h.client.raw('GET', `/api/plans/${exportsPlan}/waits`)).json()) as { waits: unknown[] }).waits).toEqual([]);
  });

  test('a dependency that could never be met is refused when it is written, by REST and by MCP', async () => {
    const put = async (deps: string[]) => h.client.raw('PUT', `/api/items/${deploy}`, { dependencies: deps });
    for (const [deps, words] of [
      [[deploy], 'An item cannot depend on itself.'],
      [['no-such-uid'], 'No item has the uid no-such-uid.'],
      [[notes], '"Design notes" is a page, not a task'],
    ] as const) {
      const res = await put([...deps]);
      expect(res.status).toBe(400);
      expect(((await res.json()) as { error: string }).error).toContain(words);
    }
    const created = await h.client.raw('POST', `/api/plans/${exportsPlan}/items`, { kind: 'action', title: 'Bad', dependencies: ['no-such-uid'] });
    expect(created.status).toBe(400);

    const viaMcp = await agent.callTool('update_item', { uid: deploy, dependencies: [notes] });
    expect(viaMcp.isError).toBe(true);
    expect(viaMcp.text).toContain('"Design notes" is a page, not a task');

    // Another plan's task is fine.
    expect((await put([migrate])).ok).toBe(true);
  });

  test('the waits route answers 404 for a plan that does not exist', async () => {
    expect((await h.client.raw('GET', '/api/plans/no-such-plan/waits')).status).toBe(404);
  });
});
