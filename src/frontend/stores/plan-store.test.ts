/**
 * The plan list (Phase 32): when two refetches are out at once, the newer
 * one's answer is the list, whichever arrives last.
 */
import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import type { Plan } from '../../shared/types';
import { usePlanStore } from './plan-store';

const realFetch = globalThis.fetch;
afterEach(() => { globalThis.fetch = realFetch; });

const plan = (uid: string) => ({ uid, title: uid }) as unknown as Plan;

test('a stale plan list that lands after a newer one is ignored', async () => {
  const pending: Array<(plans: Plan[]) => void> = [];
  globalThis.fetch = (() => new Promise((resolve) => {
    pending.push((plans) => resolve({ json: async () => plans } as Response));
  })) as typeof fetch;

  const first = usePlanStore.getState().fetchPlans();
  const second = usePlanStore.getState().fetchPlans();
  pending[1]([plan('a'), plan('b')]);
  await second;
  pending[0]([plan('a')]);
  await first;

  assert.deepEqual(usePlanStore.getState().plans.map((p) => p.uid), ['a', 'b']);
});
