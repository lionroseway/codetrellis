/**
 * Deleting an item, and listing its attachments, over REST (Phase 32 §A,
 * carried from the 0.7 review).
 *
 * Both looked tested: the coverage guard credited a route by its path, so
 * every `GET /api/items/:uid` counted for `DELETE /api/items/:uid`, and every
 * `POST …/attachments` for the `GET` beside it. With the guard crediting
 * the method a test actually sends, neither had a test at all.
 */

import { test, expect } from '@playwright/test';
import { setupHarness, openEventStream, type Harness, type EventStream } from '../harness';

interface Item { uid: string; title: string; parentUid: string | null }

test.describe.serial('Item delete and attachment list', () => {
  test.setTimeout(120_000);

  let h: Harness;
  let events: EventStream;
  let planUid: string;

  const req = async (method: string, url: string, body?: unknown) => {
    const res = await h.client.raw(method, url, body);
    expect(res.ok, `${method} ${url}: ${res.status} ${await res.clone().text()}`).toBe(true);
    return res.json();
  };
  const add = (body: Record<string, unknown>) => req('POST', `/api/plans/${planUid}/items`, body) as Promise<Item>;
  const exists = async (uid: string) => (await h.client.raw('GET', `/api/items/${uid}`)).status !== 404;

  test.beforeAll(async () => {
    h = await setupHarness('item-delete-attachments');
    await h.client.scanProject(h.fixture.projectPath);
    events = await openEventStream(h.backend);
    planUid = (await h.client.createPlan({ title: 'Delete and attach', projectPath: h.fixture.projectPath })).uid;
  });

  test.afterAll(async () => {
    await events?.close();
    await h?.teardown();
  });

  test('deleting an item removes its subtree, says which items went, and tells the window', async () => {
    const goal = await add({ kind: 'object', title: 'Faster checkout' });
    const child = await add({ kind: 'action', title: 'Cache prices', parentUid: goal.uid });
    const grandchild = await add({ kind: 'action', title: 'Pick a TTL', parentUid: child.uid });
    const sibling = await add({ kind: 'action', title: 'Unrelated' });

    const res = await req('DELETE', `/api/items/${goal.uid}`) as { ok: boolean; deleted: string[] };
    expect(res.ok).toBe(true);
    expect([...res.deleted].sort()).toEqual([goal.uid, child.uid, grandchild.uid].sort());
    for (const uid of [goal.uid, child.uid, grandchild.uid]) expect(await exists(uid), uid).toBe(false);
    expect(await exists(sibling.uid)).toBe(true);

    await events.waitFor('plan-item-deleted', (p) => p.itemUid === goal.uid && p.planUid === planUid);
  });

  test('with cascade=false, an item with children is refused and nothing is deleted; a leaf goes', async () => {
    const parent = await add({ kind: 'object', title: 'Keep me' });
    const kid = await add({ kind: 'action', title: 'Kid', parentUid: parent.uid });

    const refused = await h.client.raw('DELETE', `/api/items/${parent.uid}?cascade=false`);
    expect(refused.status).toBe(409);
    expect((await refused.json()).error).toMatch(/1 children/);
    expect(await exists(parent.uid)).toBe(true);
    expect(await exists(kid.uid)).toBe(true);

    const leaf = await req('DELETE', `/api/items/${kid.uid}?cascade=false`) as { deleted: string[] };
    expect(leaf.deleted).toEqual([kid.uid]);
    expect(await exists(kid.uid)).toBe(false);
  });

  test('deleting an item that does not exist is a 404', async () => {
    const res = await h.client.raw('DELETE', '/api/items/no-such-item');
    expect(res.status).toBe(404);
  });

  test("an item's attachments list in the order they were added; another item's are not among them", async () => {
    const item = await add({ kind: 'action', title: 'With links' });
    const other = await add({ kind: 'action', title: 'Elsewhere' });
    expect(await req('GET', `/api/items/${item.uid}/attachments`)).toEqual([]);

    const first = await req('POST', `/api/items/${item.uid}/attachments`, { kind: 'url', value: 'https://example.com/spec', label: 'Spec' });
    await req('POST', `/api/items/${other.uid}/attachments`, { kind: 'url', value: 'https://example.com/other' });
    const second = await req('POST', `/api/items/${item.uid}/attachments`, { kind: 'url', value: 'https://example.com/design' });

    const listed = await req('GET', `/api/items/${item.uid}/attachments`) as Array<{ uid: string; kind: string; value: string; label: string | null }>;
    expect(listed.map((a) => a.uid)).toEqual([first.uid, second.uid]);
    expect(listed[0]).toMatchObject({ kind: 'url', value: 'https://example.com/spec', label: 'Spec' });
    expect(listed.some((a) => a.value === 'https://example.com/other')).toBe(false);
  });
});
