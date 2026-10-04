/**
 * What a task inherits, as the routing panel shows it: claim policy,
 * execution settings, guardrails and skills, each with the item it comes
 * from. The window's plan tree holds item summaries without these, so a
 * parent's "Human only" read as "Anyone (default)" on its tasks until the
 * parent had been opened; the server now says.
 */

import { test, expect } from '@playwright/test';
import { setupHarness, type Harness } from '../harness';

interface FromItem<T> { value: T; fromUid: string | null; fromTitle: string | null }
interface Routing {
  claimPolicy: FromItem<{ mode: string }>;
  executionConfig: FromItem<{ model?: string } | null>;
  constraints: FromItem<{ requireTests?: boolean; excludePaths?: string[] }>;
  skills: Array<{ skill: { name: string }; fromUid: string; fromTitle: string }>;
}

test.describe.serial('What a task inherits', () => {
  test.setTimeout(60_000);

  let h: Harness;
  let planUid: string;
  const uid: Record<string, string> = {};

  const json = async <T>(method: string, url: string, body?: unknown) => (await (await h.client.raw(method, url, body)).json()) as T;
  const add = async (key: string, kind: 'object' | 'action', title: string, parent?: string) => {
    uid[key] = (await json<{ uid: string }>('POST', `/api/plans/${planUid}/items`, { kind, title, ...(parent ? { parentUid: uid[parent] } : {}) })).uid;
  };

  test.beforeAll(async () => {
    h = await setupHarness('item-routing');
    await h.client.scanProject(h.fixture.projectPath);
    planUid = (await h.client.createPlan({ title: 'Payments', projectPath: h.fixture.projectPath })).uid;
    await add('ledger', 'object', 'Ledger');
    await add('post', 'action', 'Post entries', 'ledger');
    await add('own', 'action', 'Reconcile nightly', 'ledger');
    await h.client.raw('PUT', `/api/items/${uid.ledger}`, {
      claimPolicy: { mode: 'human-only' }, claimPolicyMode: 'replace',
      executionConfig: { model: 'large' }, executionConfigMode: 'replace',
      constraints: { requireTests: true }, constraintsMode: 'inherit',
      skills: [{ name: 'ledger-rules', source: 'skill', required: false }],
    });
  });

  test.afterAll(async () => { await h?.teardown(); });

  test('a task shows what its section sets, and that it comes from there', async () => {
    const r = await json<Routing>('GET', `/api/items/${uid.post}/routing`);
    expect(r.claimPolicy).toEqual({ value: { mode: 'human-only' }, fromUid: uid.ledger, fromTitle: 'Ledger' });
    expect(r.executionConfig).toEqual({ value: { model: 'large' }, fromUid: uid.ledger, fromTitle: 'Ledger' });
    expect(r.constraints).toMatchObject({ value: { requireTests: true }, fromUid: uid.ledger, fromTitle: 'Ledger' });
    expect(r.skills.map((s) => [s.skill.name, s.fromTitle])).toEqual([['ledger-rules', 'Ledger']]);
  });

  test('what a task sets itself is its own; guardrails add to the section\'s', async () => {
    await h.client.raw('PUT', `/api/items/${uid.own}`, {
      claimPolicy: { mode: 'agent-only' }, claimPolicyMode: 'replace',
      constraints: { excludePaths: ['migrations/'] }, constraintsMode: 'inherit',
    });
    const r = await json<Routing>('GET', `/api/items/${uid.own}/routing`);
    expect(r.claimPolicy).toEqual({ value: { mode: 'agent-only' }, fromUid: uid.own, fromTitle: 'Reconcile nightly' });
    expect(r.executionConfig.fromUid).toBe(uid.ledger);
    expect(r.constraints.value).toMatchObject({ requireTests: true, excludePaths: ['migrations/'] });
    expect(r.constraints.fromUid).toBe(uid.own);
  });

  test('nothing set anywhere is the default, from no item; an unknown item is 404', async () => {
    const r = await json<Routing>('GET', `/api/items/${uid.ledger}/routing`);
    expect(r.claimPolicy.fromUid).toBe(uid.ledger);
    await add('loose', 'action', 'Write the changelog');
    const loose = await json<Routing>('GET', `/api/items/${uid.loose}/routing`);
    expect(loose).toEqual({
      claimPolicy: { value: { mode: 'any' }, fromUid: null, fromTitle: null },
      executionConfig: { value: null, fromUid: null, fromTitle: null },
      constraints: { value: {}, fromUid: null, fromTitle: null },
      skills: [],
    });
    expect((await h.client.raw('GET', '/api/items/no-such-item/routing')).status).toBe(404);
  });
});
