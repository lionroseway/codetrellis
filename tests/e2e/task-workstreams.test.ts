/**
 * Phase 32 A6.1 — tasks as workstreams (awareness spec §10.1).
 *
 * Priya runs two Claude Desktop sessions on two tasks of the same plan,
 * "Q3 summary" and "Board pack". Neither has a folder: each opens its task
 * with get_brief, and that binds it. Both tasks are then lines of work, the
 * same over MCP (`list_workstreams` → `tasks`, with `yours`), REST and the
 * phone. A session that opens another brief moves to that task: the latest
 * wins. A task nobody is on drops off the default list.
 */

import { test, expect } from '@playwright/test';
import { setupHarness, pairPhone, type Harness, type ScriptedAgent, type Phone } from '../harness';

interface Task { id: string; itemUid: string; title: string; planTitle: string; agents: Array<{ sessionId: string; agentType: string }>; yours?: boolean; idle: boolean }

test.describe.serial('Tasks as workstreams', () => {
  test.setTimeout(120_000);
  let h: Harness;
  let root: string;
  let phone: Phone;
  const items: Record<string, string> = {};
  const agents: Record<string, ScriptedAgent> = {};

  const post = async (url: string, body: unknown) => ((await (await h.client.raw('POST', url, body)).json()) as { uid: string }).uid;
  const tasksOver = async (who: string) => (JSON.parse((await agents[who].callTool('list_workstreams', {})).answer) as { tasks: Task[] }).tasks;
  const tasksRest = async () => (await (await h.client.raw('GET', `/api/workstreams/tasks?project=${encodeURIComponent(root)}`)).json()) as Task[];

  test.beforeAll(async () => {
    h = await setupHarness('task-workstreams');
    root = h.fixture.projectPath;
    await h.client.scanProject(root);
    const plan = (await h.client.createPlan({ title: 'Quarter close', projectPath: root })).uid;
    for (const title of ['Q3 summary', 'Board pack', 'Payroll check']) items[title] = await post(`/api/plans/${plan}/items`, { kind: 'action', title });
    for (const who of ['priyaA', 'priyaB']) agents[who] = await h.spawnAgent({ agentType: 'claude-desktop' });
    phone = await pairPhone(h.client, { alias: 'Priya’s phone' });
  });

  test.afterAll(async () => {
    await phone?.close().catch(() => {});
    await h?.teardown();
  });

  test('before any brief, no task is a line of work', async () => {
    expect(await tasksRest()).toEqual([]);
  });

  test('each session opens its task with get_brief, and both tasks are listed with their session', async () => {
    expect((await agents.priyaA.callTool('get_brief', { item_uid: items['Q3 summary'] })).isError).toBeFalsy();
    expect((await agents.priyaB.callTool('get_brief', { item_uid: items['Board pack'] })).isError).toBeFalsy();

    const viaA = await tasksOver('priyaA');
    expect(viaA.map((t) => [t.title, t.planTitle, t.agents.length, t.yours]).sort()).toEqual([
      ['Board pack', 'Quarter close', 1, false],
      ['Q3 summary', 'Quarter close', 1, true],
    ]);
    expect(viaA.find((t) => t.title === 'Q3 summary')!.id).toBe(`task:${items['Q3 summary']}`);
    expect(viaA.every((t) => t.agents[0].agentType === 'claude-desktop')).toBe(true);
    expect((await tasksOver('priyaB')).find((t) => t.yours)?.title).toBe('Board pack');

    const rest = await tasksRest();
    expect(rest.map((t) => t.title).sort()).toEqual(['Board pack', 'Q3 summary']);
    const onPhone = await phone.rpc<{ tasks: Array<{ id: string; name: string; planTitle: string; agents: unknown[] }> }>('workstreams.list');
    expect(onPhone.tasks.map((t) => t.name).sort()).toEqual(['Task · Board pack', 'Task · Q3 summary']);
    expect(onPhone.tasks.map((t) => t.id).sort()).toEqual(rest.map((t) => t.id).sort());
  });

  test('the latest brief wins: a session that opens another task moves to it', async () => {
    await agents.priyaB.callTool('get_brief', { item_uid: items['Payroll check'] });
    const now = await tasksRest();
    expect(now.map((t) => t.title).sort()).toEqual(['Payroll check', 'Q3 summary']);
    // Asked for idle ones too, the task left behind has no session.
    const all = (await (await h.client.raw('GET', `/api/workstreams/tasks?project=${encodeURIComponent(root)}&idle=1`)).json()) as Task[];
    expect(all.find((t) => t.title === 'Board pack')).toBeUndefined(); // nothing recorded on it, so not even idle
  });

  test('get_awareness names the caller\'s task', async () => {
    const aw = JSON.parse((await agents.priyaA.callTool('get_awareness', {})).answer) as { your_task: string | null };
    expect(aw.your_task).toBe(`task:${items['Q3 summary']}`);
  });
});
