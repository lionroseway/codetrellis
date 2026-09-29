/**
 * An agent held at a person's breakpoint reaches them away from the desk
 * (Phase 32 B4.4): one push per device, rate-limited, nothing when the push
 * service is off. The words name the agent only: which file or task is held
 * loads over WebRTC, never in a payload a push service sees. Expo is
 * stubbed; nothing leaves the machine.
 */
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import {
  startPushNotifications, stopPushNotifications, registerPushToken, pushForBreakpoint,
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
  await pushForBreakpoint({ ref: 'bp-1', breach: false, agent: 'codex', planUid: 'plan-1' });
  assert.equal(sent.length, 0);
});

test('on: a held agent is one push per device, naming the agent only; the tap carries the ref; a second within a minute is held', async () => {
  startPushNotifications();
  registerPushToken('AA:phone', 'ExponentPushToken[abc]');
  await pushForBreakpoint({ ref: 'bp-1', breach: false, agent: 'claude-code', planUid: 'plan-1' });
  assert.equal(sent.length, 1);
  assert.match(sent[0].url, /exp\.host/);
  assert.deepEqual(sent[0].body, [{
    to: 'ExponentPushToken[abc]',
    title: 'Waiting on you',
    body: 'Claude Code is held at one of your breakpoints until you answer.',
    data: { type: 'breakpoint', ref: 'bp-1', planUid: 'plan-1' },
    sound: 'default',
    channelId: 'codetrellis-events',
  }]);

  await pushForBreakpoint({ ref: 'bp-2', breach: false, agent: 'codex', planUid: 'plan-1' });
  assert.equal(sent.length, 1, 'rate-limited per device');
});

test('a breach says what happened, never that the agent was paused; a hit with no plan carries no plan id', async () => {
  registerPushToken('BB:phone', 'ExponentPushToken[def]');
  await pushForBreakpoint({ ref: 'bp-3', breach: true, agent: 'codex', planUid: null });
  assert.equal(sent.length, 2);
  assert.deepEqual(sent[1].body, [{
    to: 'ExponentPushToken[def]',
    title: 'Edited past a breakpoint',
    body: 'codex changed code past one of your breakpoints and was told to stop.',
    data: { type: 'breakpoint', ref: 'bp-3' },
    sound: 'default',
    channelId: 'codetrellis-events',
  }]);
});
