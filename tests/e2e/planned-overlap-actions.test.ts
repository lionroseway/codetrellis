/**
 * Phase 32 B9.3a — acting on a planned overlap (JOURNEYS G3).
 *
 * JIRA-142 and JIRA-150 both plan to change validators.ts, and an agent
 * holds each plan's task. Sam tells both agents: each is told once, on its
 * next step, what the other plan plans; a second step says nothing more.
 * He leaves it: the overlap stays, marked left, with who chose that. Then he
 * re-sequences, JIRA-142 first: JIRA-150's task now waits on JIRA-142's,
 * and the overlap reads sequenced. Putting JIRA-150 first now would make
 * them wait on each other, and is refused. Every decision is the person's,
 * from the transport; an unknown overlap or action is refused.
 */

import { test, expect } from '@playwright/test';
import { setupHarness, type Harness, type ScriptedAgent } from '../harness';
import type { PlayForward } from '../../src/shared/types/play-forward';

const VALIDATORS = 'packages/shared/src/validators.ts';

test.describe.serial('Acting on a planned overlap', () => {
  test.setTimeout(150_000);
  let h: Harness;
  let root: string;
  let vatAgent: ScriptedAgent;
  let currencyAgent: ScriptedAgent;
  let vatPlan: string;
  let currencyPlan: string;
  let vatTask: string;
  let currencyTask: string;
  let id: string;

  const q = () => `?project=${encodeURIComponent(root)}`;
  const forward = async () => (await (await h.client.raw('GET', `/api/play-forward${q()}`)).json()) as PlayForward;
  const act = (action: string, body: unknown = {}, overlap = id) => h.client.raw('POST', `/api/play-forward/overlaps/${overlap}/${action}${q()}`, body);
  const overlap = async () => (await forward()).overlaps.find((o) => o.kind === 'file')!;
  const item = async (uid: string) => (await (await h.client.raw('GET', `/api/items/${uid}`)).json()) as { dependencies?: string[] };

  test.beforeAll(async () => {
    h = await setupHarness('planned-overlap-actions');
    root = h.fixture.projectPath;
    await h.client.scanProject(root);
    vatAgent = await h.spawnAgent({ agentType: 'claude-code' });
    currencyAgent = await h.spawnAgent({ agentType: 'codex' });
    const plan = async (title: string, key: string) => {
      const uid = (await h.client.createPlan({ title, projectPath: root })).uid;
      await vatAgent.callTool('set_plan_external_ref', { plan_uid: uid, url: `https://example.atlassian.net/browse/${key}`, key });
      return uid;
    };
    vatPlan = await plan('VAT rounding', 'JIRA-142');
    currencyPlan = await plan('Currency', 'JIRA-150');
    const add = async (planUid: string, title: string) =>
      ((await (await h.client.raw('POST', `/api/plans/${planUid}/items`, { kind: 'action', title, fileSpecs: [{ path: VALIDATORS, action: 'modify' }] })).json()) as { uid: string }).uid;
    vatTask = await add(vatPlan, 'Round VAT per line');
    currencyTask = await add(currencyPlan, 'Add a currency field');
    expect((await vatAgent.claimItem(vatTask)).isError).toBeFalsy();
    expect((await currencyAgent.claimItem(currencyTask)).isError).toBeFalsy();
    id = (await overlap()).id;
  });
  test.afterAll(async () => { await h?.teardown(); });

  test('tell both agents: each is told once, on its next step, what the other plan plans', async () => {
    const r = await act('tell');
    expect(r.status).toBe(200);
    expect(await r.json()).toMatchObject({ told: 2, tasksWithoutAgent: [] });

    const first = await vatAgent.callTool('list_plans', {});
    expect(first.text).toContain('── CodeTrellis: planned overlap ──');
    expect(first.text).toMatch(/asks you to know: JIRA-1(42|50) and JIRA-1(42|50) both plan to change packages\/shared\/src\/validators\.ts\./);
    expect(first.text).toContain('Your task "Round VAT per line" (JIRA-142) and "Add a currency field" in JIRA-150 both plan to touch packages/shared/src/validators.ts.');
    expect((await vatAgent.callTool('list_plans', {})).text).not.toContain('planned overlap ──');

    const other = await currencyAgent.callTool('list_plans', {});
    expect(other.text).toContain('Your task "Add a currency field" (JIRA-150) and "Round VAT per line" in JIRA-142');

    const o = await overlap();
    expect(o.decisions.at(-1)).toMatchObject({ action: 'tell', words: 'Told 2 agents' });
    // Over plain HTTP, the person is "unverified", from the transport, never the request.
    expect(o.decisions.at(-1)!.byType).toBe('unverified');
  });

  test('leave it: it stays, marked left, with who chose that', async () => {
    expect((await act('leave')).status).toBe(200);
    const o = await overlap();
    expect(o.left).toBe(true);
    expect(o.decisions.at(-1)!.action).toBe('leave');
    expect(o.decisions.at(-1)!.words).toMatch(/^Left as it is by /);
  });

  test('re-sequence, JIRA-142 first: JIRA-150\'s task waits on it, and the overlap reads sequenced', async () => {
    const r = await act('resequence', { first: vatPlan });
    expect(r.status).toBe(200);
    expect(((await r.json()) as { waiting: Array<{ title: string }> }).waiting.map((w) => w.title)).toEqual(['Add a currency field']);
    expect((await item(currencyTask)).dependencies).toEqual([vatTask]);
    const o = await overlap();
    expect(o.sequenced).toBe(true);
    expect(o.left).toBe(false);
    expect(o.words).toMatch(/ · sequenced: JIRA-150 waits on JIRA-142$/);
    expect(o.decisions.at(-1)).toMatchObject({ action: 'resequence', words: 'JIRA-142 goes first; JIRA-150 waits' });
  });

  test('putting JIRA-150 first now would make them wait on each other: refused; bad input refused', async () => {
    const loop = await act('resequence', { first: currencyPlan });
    expect(loop.status).toBe(409);
    expect(((await loop.json()) as { error: string }).error).toBe('JIRA-150 cannot go first: its task "Add a currency field" already waits on the other plan\'s work, so they would wait on each other.');
    expect((await item(vatTask)).dependencies ?? []).toEqual([]);
    expect((await act('resequence', {})).status).toBe(400);
    expect((await act('resequence', { first: 'not-a-plan' })).status).toBe(400);
    expect((await act('leave', {}, 'no-such-overlap')).status).toBe(404);
    expect((await act('shrug')).status).toBe(404);
    expect((await h.client.raw('POST', `/api/play-forward/overlaps/${id}/leave`, {})).status).toBe(400);
  });
});
