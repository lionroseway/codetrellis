/**
 * Plan items: history, structure, discussion and links (Phase 32 §0.4c-2).
 *
 * Versions and restore, the event log, move (including a move that would
 * make an item its own ancestor), comments over REST and MCP, attachments,
 * external refs, the plan summary and suggest_specs — the item surface that
 * had no test.
 */

import { test, expect } from '@playwright/test';
import { setupHarness, type Harness, type ScriptedAgent } from '../harness';

interface Item { uid: string; title: string; parentUid: string | null; sortOrder: number; status: string | null }

test.describe.serial('Item surface', () => {
  test.setTimeout(120_000);

  let h: Harness;
  let agent: ScriptedAgent;
  let planUid: string;
  let goal: Item;
  let action: Item;

  const req = async (method: string, url: string, body?: unknown) => {
    const res = await h.client.raw(method, url, body);
    expect(res.ok, `${method} ${url}: ${res.status} ${await res.clone().text()}`).toBe(true);
    return res.json();
  };
  const call = async (name: string, args: Record<string, unknown>) => {
    const res = await agent.callTool(name, args);
    expect(res.isError, `${name}: ${res.text}`).not.toBe(true);
    return res.text;
  };
  const tool = async (name: string, args: Record<string, unknown>) => JSON.parse(await call(name, args));

  test.beforeAll(async () => {
    h = await setupHarness('item-surface');
    await h.client.scanProject(h.fixture.projectPath);
    agent = await h.spawnAgent({ agentType: 'item-agent' });
    planUid = (await h.client.createPlan({ title: 'Item surface', projectPath: h.fixture.projectPath })).uid;
    goal = await req('POST', `/api/plans/${planUid}/items`, { kind: 'object', title: 'Faster checkout' });
    action = await req('POST', `/api/plans/${planUid}/items`, {
      kind: 'action', title: 'Cache prices', fileSpecs: [{ path: 'packages/web/src/api.ts', action: 'modify' }],
    });
  });

  test.afterAll(async () => {
    await h?.teardown();
  });

  test('an edit records a version and an event; restore brings the old state back as a new version', async () => {
    await req('PUT', `/api/items/${action.uid}`, { title: 'Cache prices for 60s' });

    const versions = (await req('GET', `/api/items/${action.uid}/versions`)) as Array<{ version: number; metaSnapshot: { title: string } }>;
    expect(versions[0].metaSnapshot.title).toBe('Cache prices for 60s');
    const first = versions.find((v) => v.metaSnapshot.title === 'Cache prices')!;
    expect(first).toBeTruthy();

    const events = (await req('GET', `/api/items/${action.uid}/events`)) as Array<{ eventType: string; beforeState: unknown; afterState: unknown }>;
    expect(events).toContainEqual(expect.objectContaining({
      eventType: 'item_renamed', beforeState: { title: 'Cache prices' }, afterState: { title: 'Cache prices for 60s' },
    }));

    const restored = (await req('POST', `/api/items/${action.uid}/restore-version/${first.version}`)) as Item;
    expect(restored.title).toBe('Cache prices');
    const viaMcp = (await tool('list_item_versions', { uid: action.uid })) as Array<{ version: number; metaSnapshot: { title: string } }>;
    expect(viaMcp[0].version).toBeGreaterThan(versions[0].version);
    expect(viaMcp[0].metaSnapshot.title).toBe('Cache prices');

    expect((await h.client.raw('POST', `/api/items/${action.uid}/restore-version/999`)).status).toBe(404);
  });

  test('move re-parents and reorders', async () => {
    const moved = (await req('POST', `/api/items/${action.uid}/move`, { newParentUid: goal.uid, newSortOrder: 0 })) as Item;
    expect(moved.parentUid).toBe(goal.uid);
    const children = (await req('GET', `/api/plans/${planUid}/items?parent_uid=${goal.uid}`)) as Item[];
    expect(children.map((c) => c.uid)).toEqual([action.uid]);
    expect((await h.client.raw('POST', '/api/items/no-such-item/move', { newParentUid: null })).status).toBe(404);
  });

  test('no route can put an item where the tree cannot hold it (bug 23)', async () => {
    // goal ─ sub ─ (action already under goal)
    const sub = (await req('POST', `/api/plans/${planUid}/items`, { kind: 'object', title: 'Sub-goal', parentUid: goal.uid })) as Item;
    const otherPlan = (await h.client.createPlan({ title: 'Elsewhere', projectPath: h.fixture.projectPath })).uid;
    const foreign = (await req('POST', `/api/plans/${otherPlan}/items`, { kind: 'object', title: 'Foreign' })) as Item;

    const bad: Array<[string, Record<string, unknown>]> = [
      ['under its own sub-item', { newParentUid: sub.uid }],
      ['under itself', { newParentUid: goal.uid }],
      ['under an item in another plan', { newParentUid: foreign.uid }],
      ['under an item that does not exist', { newParentUid: 'no-such-item' }],
    ];
    for (const [why, body] of bad) {
      const res = await h.client.raw('POST', `/api/items/${goal.uid}/move`, body);
      expect(res.status, `move ${why}`).toBe(400);
    }
    // The same through update and create, and through the agent's move_item.
    expect((await h.client.raw('PUT', `/api/items/${goal.uid}`, { parentUid: sub.uid })).status).toBe(400);
    expect((await h.client.raw('POST', `/api/plans/${planUid}/items`, { kind: 'object', title: 'x', parentUid: foreign.uid })).status).toBe(400);
    const viaAgent = await agent.callTool('move_item', { uid: goal.uid, new_parent_uid: sub.uid });
    expect(viaAgent.isError).toBe(true);
    expect(viaAgent.text).toMatch(/own sub-items/);

    // Nothing moved.
    expect(((await req('GET', `/api/items/${goal.uid}`)) as Item).parentUid).toBeNull();
    const roots = (await req('GET', `/api/plans/${planUid}/items?parent_uid=`)) as Item[];
    expect(roots.map((r) => r.uid)).toContain(goal.uid);
  });

  test('comments: add, read and delete over REST, and delete through MCP', async () => {
    const human = await req('POST', '/api/comments', { targetType: 'item', targetUid: action.uid, body: 'Watch the TTL' });
    const reply = await req('POST', '/api/comments', { targetType: 'item', targetUid: action.uid, body: 'Agreed', parentUid: human.uid });
    const thread = (await req('GET', `/api/comments?target=${action.uid}`)) as Array<{ uid: string; replies: Array<{ uid: string }> }>;
    expect(thread.map((c) => c.uid)).toEqual([human.uid]);
    expect(thread[0].replies.map((r) => r.uid)).toEqual([reply.uid]);

    const byAgent = await tool('add_item_comment', { uid: action.uid, kind: 'note', body: 'Invalidate on price change' });
    await call('delete_item_comment', { comment_uid: byAgent.uid ?? byAgent.comment?.uid });
    await req('DELETE', `/api/comments/${reply.uid}`);

    const after = (await req('GET', `/api/comments?target=${action.uid}`)) as Array<{ uid: string; body: string; replies: unknown[] }>;
    expect(after.map((c) => c.body)).not.toContain('Invalidate on price change');
    expect(after.find((c) => c.uid === human.uid)!.replies).toEqual([]);
    expect((await h.client.raw('POST', '/api/comments', { targetType: 'item', targetUid: action.uid })).status).toBe(400);
  });

  test('attachments: add through MCP, remove through MCP and REST', async () => {
    const one = await tool('add_item_attachment', { uid: action.uid, kind: 'url', value: 'https://example.com/pricing-spec' });
    const two = await tool('add_item_attachment', { uid: action.uid, kind: 'url', value: 'https://example.com/cache-notes' });
    const listed = () => req('GET', `/api/items/${action.uid}/full`).then((f: { attachments: Array<{ uid: string }> }) => f.attachments.map((a) => a.uid));
    expect(await listed()).toEqual(expect.arrayContaining([one.uid, two.uid]));

    await call('delete_item_attachment', { attachment_uid: one.uid });
    await req('DELETE', `/api/attachments/${two.uid}`);
    expect(await listed()).toEqual([]);
    expect((await h.client.raw('DELETE', `/api/attachments/${two.uid}`)).status).toBe(404);
  });

  test('external refs: a GitHub issue URL is recognised, listed and removed', async () => {
    const ref = await tool('add_external_ref', { item_uid: action.uid, url: 'https://github.com/acme/app/issues/42' });
    expect(ref).toMatchObject({ kind: 'github_issue', title: 'acme/app#42' });
    const refs = (await tool('list_external_refs', { item_uid: action.uid })) as Array<{ uid: string }>;
    expect(refs.map((r) => r.uid)).toEqual([ref.uid]);
    await call('remove_external_ref', { uid: ref.uid });
    expect(await tool('list_external_refs', { item_uid: action.uid })).toEqual([]);
  });

  test('get_plan_summary counts items and progress', async () => {
    await req('PUT', `/api/items/${action.uid}`, { status: 'done' });
    const summary = await tool('get_plan_summary', { plan_uid: planUid });
    expect(summary.plan).toMatchObject({ uid: planUid, title: 'Item surface' });
    // goal, sub-goal and the action; the other plan's item is not counted.
    expect(summary.items).toMatchObject({ total: 3, objects: 2, actions: 1 });
    expect(summary.progress.byStatus).toEqual({ done: 1 });
    expect(summary.progress.completionPercent).toBe(100);
  });

  test('suggest_specs proposes file specs under a scope', async () => {
    const res = await tool('suggest_specs', { scope_path: 'packages/web' });
    expect(res.scopePath).toBe('packages/web');
    const paths = (res.files as Array<{ path: string; suggestedFileSpec: { path: string; action: string } }>).map((f) => f.path);
    expect(paths).toContain('packages/web/src/api.ts');
    expect(paths.every((p) => p.startsWith('packages/web/'))).toBe(true);
    expect(res.files[0].suggestedFileSpec.action).toBe('modify');
  });
});
