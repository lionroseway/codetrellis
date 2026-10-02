/**
 * Phase 32 B6.5 — one clock: the stack at a moment, end to end.
 *
 * Journey H1, looking back: "what was in flight at 10:40?" The stack then
 * is the one the window showed then: which plans were under way, who was on
 * each task, its branch, and what it waited on. Here: Billing starts alone;
 * Exports arrives, its task waiting on Billing's; Codex takes Billing's task
 * and later finishes it, and the Exports task moves to another branch.
 * Asked about each moment afterwards, the stack says what was true then.
 */

import { execFileSync } from 'node:child_process';
import { test, expect } from '@playwright/test';
import { setupHarness, type Harness, type ScriptedAgent } from '../harness';
import type { Stack, StackPlan, StackTask } from '../../src/shared/types/stack';

const ENV = { ...process.env, GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@x', GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@x' };

interface StateAt {
  tasks: Array<{ uid: string; status: string | null; assignee: string | null; workstream: string | null; dependencies: string[] }>;
  stack: Stack;
}

test.describe.serial('The stack at a moment', () => {
  let h: Harness;
  let root: string;
  let agent: ScriptedAgent;
  let billing: string;
  let exportsPlan: string;
  let migrate: string;
  let deploy: string;
  let section: string;
  const moments: Record<string, number> = {};

  const raw = (method: string, url: string, body?: unknown) => h.client.raw(method, url, body);
  const post = async (url: string, body: unknown) => (await raw('POST', url, body)).json() as Promise<{ uid: string }>;
  const stateAt = async (at: number) =>
    (await (await raw('GET', `/api/replay/state?project=${encodeURIComponent(root)}&at=${at}`)).json()) as StateAt;
  const planIn = (s: Stack, uid: string): StackPlan | undefined => s.plans.find((p) => p.uid === uid);
  const taskIn = (s: Stack, uid: string): StackTask | undefined => s.plans.flatMap((p) => p.tasks).find((t) => t.uid === uid);
  /** A moment strictly between what happened before and what happens next. */
  const mark = async (name: string) => {
    await new Promise((r) => setTimeout(r, 30));
    moments[name] = Date.now();
    await new Promise((r) => setTimeout(r, 30));
  };

  test.beforeAll(async () => {
    h = await setupHarness('stack-at');
    root = h.fixture.projectPath;
    // The two lines of work the Exports section moves between.
    for (const branch of ['exports-v1', 'exports-v2']) {
      execFileSync('git', ['-C', root, 'worktree', 'add', '-q', `${root}-${branch}`, '-b', branch], { env: ENV });
    }
    await h.client.scanProject(root);
    agent = await h.spawnAgent({ agentType: 'codex' });

    billing = (await h.client.createPlan({ title: 'Billing v2', projectPath: root })).uid;
    migrate = (await post(`/api/plans/${billing}/items`, { kind: 'action', title: 'Migrate schema' })).uid;
    await mark('alone');

    exportsPlan = (await h.client.createPlan({ title: 'Exports', projectPath: root })).uid;
    section = (await post(`/api/plans/${exportsPlan}/items`, { kind: 'object', title: 'Rollout' })).uid;
    expect((await raw('PUT', `/api/items/${section}/workstream`, { workstream: 'exports-v1' })).ok).toBe(true);
    deploy = (await post(`/api/plans/${exportsPlan}/items`, { kind: 'action', title: 'Deploy exports', parentUid: section, dependencies: [migrate] })).uid;
    await agent.claimItem(migrate);
    await mark('waiting');

    expect((await raw('PUT', `/api/items/${migrate}`, { status: 'done' })).ok).toBe(true);
    expect((await raw('PUT', `/api/items/${section}/workstream`, { workstream: 'exports-v2' })).ok).toBe(true);
    await mark('after');
  });

  test.afterAll(async () => {
    for (const branch of ['exports-v1', 'exports-v2']) {
      try { execFileSync('git', ['-C', root, 'worktree', 'remove', '--force', `${root}-${branch}`]); } catch { /* */ }
    }
    await h?.teardown();
  });

  test('before a plan was made, it is not in the stack; a task made later is not either', async () => {
    const { stack, tasks } = await stateAt(moments.alone);
    expect(stack.plans.map((p) => p.title)).toEqual(['Billing v2']);
    expect(taskIn(stack, migrate)).toMatchObject({ assignee: null, status: 'pending', dependencies: [] });
    expect(tasks.map((t) => t.uid)).toEqual([migrate]);
  });

  test('who was on each task then, what it waited on across plans, and the branch it was worked on then', async () => {
    const { stack, tasks } = await stateAt(moments.waiting);
    expect(stack.plans.map((p) => p.title).sort()).toEqual(['Billing v2', 'Exports']);
    expect(taskIn(stack, migrate)).toMatchObject({ assignee: 'codex', status: 'assigned' });

    const waiting = taskIn(stack, deploy)!;
    expect(waiting.workstream).toBe('exports-v1');
    expect(waiting.dependencies).toEqual([
      expect.objectContaining({ uid: migrate, met: false, problem: 'unfinished', planUid: billing, planTitle: 'Billing v2' }),
    ]);
    expect(waiting.waits).toContain('Migrate schema');

    // The state's task list says the same, for readers that only want the tasks.
    expect(tasks.find((t) => t.uid === deploy)).toMatchObject({ workstream: 'exports-v1', dependencies: [migrate] });
    expect(tasks.find((t) => t.uid === migrate)).toMatchObject({ assignee: 'codex' });
  });

  test('afterwards the same tasks read as they became: the wait met, the branch moved', async () => {
    const { stack } = await stateAt(moments.after);
    expect(taskIn(stack, migrate)!.status).toBe('done');
    const deployAfter = taskIn(stack, deploy)!;
    expect(deployAfter.workstream).toBe('exports-v2');
    expect(deployAfter.dependencies).toEqual([expect.objectContaining({ uid: migrate, met: true })]);
    expect(deployAfter.waits).toBeNull();
    expect(planIn(stack, billing)!.progress).toEqual({ done: 1, total: 1 });
  });

  test('the stack now, from replay, is the live stack', async () => {
    const [{ stack: then }, live] = await Promise.all([
      stateAt(Date.now()),
      raw('GET', `/api/stack?project=${encodeURIComponent(root)}`).then((r) => r.json() as Promise<Stack>),
    ]);
    const shape = (s: Stack) => s.plans.map((p) => ({
      uid: p.uid, progress: p.progress,
      tasks: p.tasks.map((t) => ({ uid: t.uid, status: t.status, assignee: t.assignee, workstream: t.workstream, deps: t.dependencies.map((d) => d.met) })),
    }));
    expect(shape(then)).toEqual(shape(live));
  });
});
