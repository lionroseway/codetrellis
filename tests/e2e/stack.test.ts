/**
 * The stack (Phase 32 B6.2): every active plan in a project and its tasks,
 * in one answer, for the window and for any agent.
 *
 * Two active plans and a completed one. Exports is called by its ticket key,
 * its tasks are worked on a branch set on their section, and "Deploy exports"
 * waits on Billing's "Migrate schema". The completed plan is not in the stack.
 * An agent's `get_stack` answers the same, and a project that was never
 * opened is refused.
 */

import { test, expect } from '@playwright/test';
import { setupHarness, type Harness } from '../harness';
import type { ScriptedAgent } from '../harness/scripted-agent';
import type { Stack } from '../../src/shared/types/stack';

test.describe.serial('The stack', () => {
  test.setTimeout(90_000);

  let h: Harness;
  let agent: ScriptedAgent;
  let root: string;
  let billing: string;
  let exportsPlan: string;
  let migrate: string;
  let deploy: string;

  const post = async (path: string, body: unknown) => (await h.client.raw('POST', path, body)).json() as Promise<{ uid: string }>;
  const stack = async () => (await (await h.client.raw('GET', `/api/stack?project=${encodeURIComponent(root)}`)).json()) as Stack;

  test.beforeAll(async () => {
    h = await setupHarness('stack');
    root = h.fixture.projectPath;
    await h.client.scanProject(root);
    agent = await h.spawnAgent({ agentType: 'codex' });

    billing = (await h.client.createPlan({ title: 'Billing v2', projectPath: root })).uid;
    exportsPlan = (await h.client.createPlan({ title: 'Exports', projectPath: root })).uid;
    const shipped = (await h.client.createPlan({ title: 'Shipped last week', projectPath: root })).uid;
    expect((await h.client.raw('PUT', `/api/plans/${shipped}`, { status: 'completed' })).ok).toBe(true);

    migrate = (await post(`/api/plans/${billing}/items`, { kind: 'action', title: 'Migrate schema' })).uid;
    const section = (await post(`/api/plans/${exportsPlan}/items`, { kind: 'object', title: 'Rollout' })).uid;
    expect((await h.client.raw('PUT', `/api/items/${section}/workstream`, { workstream: 'main' })).ok).toBe(true);
    deploy = (await post(`/api/plans/${exportsPlan}/items`, { kind: 'action', title: 'Deploy exports', parentUid: section, dependencies: [migrate] })).uid;

    await agent.callTool('set_plan_external_ref', { plan_uid: exportsPlan, url: 'https://example.atlassian.net/browse/JIRA-150', key: 'JIRA-150' });
    await agent.claimItem(migrate);
  });

  test.afterAll(async () => { await h?.teardown(); });

  test('every active plan, called by its ticket key, and never a completed one', async () => {
    const { plans } = await stack();
    expect(plans.map((p) => p.title).sort()).toEqual(['Billing v2', 'Exports']);
    const exp = plans.find((p) => p.uid === exportsPlan)!;
    expect(exp).toMatchObject({ label: 'JIRA-150', ticketKey: 'JIRA-150', progress: { done: 0, total: 1 }, needsYou: 0 });
    expect(plans.find((p) => p.uid === billing)!.label).toBe('Billing v2');
  });

  test('each task says who is on it, where it is worked, and what it waits on in another plan', async () => {
    const { plans } = await stack();
    const migrateTask = plans.find((p) => p.uid === billing)!.tasks.find((t) => t.uid === migrate)!;
    expect(migrateTask).toMatchObject({ assignee: 'codex', status: 'assigned' });

    const deployTask = plans.find((p) => p.uid === exportsPlan)!.tasks.find((t) => t.uid === deploy)!;
    expect(deployTask.workstream).toBe('main');
    expect(deployTask.waits).toBe('"Deploy exports" waits on "Migrate schema" in plan "Billing v2".');
    expect(deployTask.dependencies).toEqual([{
      uid: migrate, met: false, problem: 'unfinished', title: 'Migrate schema', planUid: billing, planTitle: 'Billing v2',
      words: 'waits on "Migrate schema" in plan "Billing v2"',
    }]);
  });

  test('once the other plan\'s task is done, the wait is gone from the stack', async () => {
    expect((await h.client.raw('PUT', `/api/items/${migrate}`, { status: 'done' })).ok).toBe(true);
    const { plans } = await stack();
    const deployTask = plans.find((p) => p.uid === exportsPlan)!.tasks.find((t) => t.uid === deploy)!;
    expect(deployTask.waits).toBeNull();
    expect(deployTask.dependencies[0]).toMatchObject({ met: true, planTitle: 'Billing v2', words: null });
    expect(plans.find((p) => p.uid === billing)!.progress).toEqual({ done: 1, total: 1 });
  });

  test('an agent\'s get_stack answers the same', async () => {
    const viaMcp = JSON.parse((await agent.callTool('get_stack', { project_path: root })).answer) as Stack;
    expect(viaMcp).toEqual(await stack());
  });

  test('a project that was never opened is refused', async () => {
    expect((await h.client.raw('GET', `/api/stack?project=${encodeURIComponent('/tmp/never-opened')}`)).ok).toBe(false);
  });
});
