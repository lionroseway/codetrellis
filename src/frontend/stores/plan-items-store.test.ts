/**
 * The plan item list (Phase 32): opening a plan asks for its items twice, and
 * an item opened while that is loading keeps its body when the list lands.
 */
import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { usePlanItemsStore } from './plan-items-store';

const realFetch = globalThis.fetch;
afterEach(() => { globalThis.fetch = realFetch; });

const summary = { uid: 'i1', planUid: 'p1', parentUid: null, kind: 'action', title: 'First task', status: 'pending' };
const full = { ...summary, body: 'Do the first thing' };

test('an item opened while its plan loads keeps its body when the list lands', async () => {
  const lists: Array<() => void> = [];
  const urls: string[] = [];
  globalThis.fetch = ((url: string) => {
    urls.push(url);
    if (url.endsWith('/items')) {
      return new Promise((resolve) => lists.push(() => resolve({ ok: true, json: async () => [summary] } as Response)));
    }
    if (url.includes('/timeline')) return Promise.resolve({ ok: true, json: async () => [] } as Response);
    return Promise.resolve({ ok: true, json: async () => ({ item: full, children: [], comments: [], criteria: [], attachments: [] }) } as Response);
  }) as typeof fetch;

  const store = usePlanItemsStore.getState();
  store.resetForPlan('p1');
  const first = store.hydratePlan('p1');
  const second = usePlanItemsStore.getState().hydratePlan('p1');
  assert.equal(urls.filter((u) => u.endsWith('/items')).length, 1, 'one list request for both calls');

  // The person opens the item before the list has answered.
  await usePlanItemsStore.getState().fetchItemFull('i1');
  lists.forEach((answer) => answer());
  await Promise.all([first, second]);

  const item = usePlanItemsStore.getState().itemsByUid.i1;
  assert.equal(item.body, 'Do the first thing');
  assert.equal(usePlanItemsStore.getState().hydratedFor, 'p1');
});

test('a list for a plan that is no longer open is dropped', async () => {
  let answer: () => void = () => {};
  globalThis.fetch = ((url: string) => {
    if (url.includes('/plans/old/items')) {
      return new Promise((resolve) => { answer = () => resolve({ ok: true, json: async () => [{ ...summary, uid: 'old-item', planUid: 'old' }] } as Response); });
    }
    return Promise.resolve({ ok: true, json: async () => [] } as Response);
  }) as typeof fetch;

  const store = usePlanItemsStore.getState();
  store.resetForPlan('old');
  const old = store.hydratePlan('old');
  usePlanItemsStore.getState().resetForPlan('new');
  await usePlanItemsStore.getState().hydratePlan('new');
  answer();
  await old;

  assert.equal(usePlanItemsStore.getState().activePlanUid, 'new');
  assert.equal(usePlanItemsStore.getState().itemsByUid['old-item'], undefined);
});
