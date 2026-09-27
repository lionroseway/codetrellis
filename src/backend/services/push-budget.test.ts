/**
 * An agent's budget change reaches a person away from the desk (Phase 32,
 * owner's request): one push per device, carrying only ids, rate-limited,
 * and nothing when the push service is off. Expo is stubbed; nothing
 * leaves the machine.
 */
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import {
  startPushNotifications, stopPushNotifications, registerPushToken, pushForBudgetChange,
} from './push-notification-service';

const sent: Array<{ url: string; body: unknown }> = [];
const realFetch = globalThis.fetch;

before(() => {
  globalThis.fetch = (async (url: string, init?: { body?: string }) => {
    sent.push({ url: String(url), body: JSON.parse(init?.body ?? 'null') });
    return new Response('{}', { status: 200 });
  }) as typeof fetch;
});
after(() => { globalThis.fetch = realFetch; stopPushNotifications(); });

test('off, nothing is sent', async () => {
  await pushForBudgetChange('plan-1', 'Q3 board pack', 'codex');
  assert.equal(sent.length, 0);
});

test('on: one push per device, ids only, the tap opens the plan; a second within a minute is held', async () => {
  startPushNotifications();
  registerPushToken('AA:phone', 'ExponentPushToken[abc]');
  await pushForBudgetChange('plan-1', 'Q3 board pack', 'codex');
  assert.equal(sent.length, 1);
  assert.match(sent[0].url, /exp\.host/);
  assert.deepEqual(sent[0].body, [{
    to: 'ExponentPushToken[abc]',
    title: 'Budget changed by an agent',
    body: 'codex changed the budget on Q3 board pack',
    data: { type: 'budget-change', planUid: 'plan-1' },
    sound: 'default',
    channelId: 'codetrellis-events',
  }]);

  await pushForBudgetChange('plan-1', 'Q3 board pack', 'codex');
  assert.equal(sent.length, 1, 'rate-limited per device');
});
