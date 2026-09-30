/**
 * A serious overlap reaches a person away from the desk (Phase 32 A4.4):
 * high severity only, one push per kind per minute per device, words that
 * name no file, function or agent, and the signal's id for the tap. Which
 * signals count as newly serious is pure, and tested here too. Expo is
 * stubbed; nothing leaves the machine, and the push URL can only be pointed
 * at this machine.
 */
import { test, before, after, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  startPushNotifications, stopPushNotifications, registerPushToken, pushForSignal, pushUrl,
} from './push-notification-service';
import { newlySerious } from './awareness-signals';
import type { AwarenessSignal } from '../../shared/types';

const sent: Array<{ url: string; body: unknown }> = [];
const realFetch = globalThis.fetch;

before(() => {
  globalThis.fetch = (async (url: string, init?: { body?: string }) => {
    sent.push({ url: String(url), body: JSON.parse(init?.body ?? 'null') });
    return new Response('{}', { status: 200 });
  }) as typeof fetch;
});
after(() => { globalThis.fetch = realFetch; stopPushNotifications(); });

describe('the push', () => {
  test('off, nothing is sent', async () => {
    await pushForSignal({ id: 's1', kind: 'contract', severity: 'high' });
    assert.equal(sent.length, 0);
  });

  test('on: a high contract is one push per device, in words naming nothing; the tap carries the id; medium is never pushed', async () => {
    startPushNotifications();
    registerPushToken('AA:phone', 'ExponentPushToken[abc]');
    await pushForSignal({ id: 's-med', kind: 'contract', severity: 'medium' });
    assert.equal(sent.length, 0);
    await pushForSignal({ id: 's1', kind: 'contract', severity: 'high' });
    assert.equal(sent.length, 1);
    assert.match(sent[0].url, /exp\.host/);
    assert.deepEqual(sent[0].body, [{
      to: 'ExponentPushToken[abc]',
      title: 'Needs you',
      body: 'An exported function another line of work uses has changed.',
      data: { type: 'signal', id: 's1' },
      sound: 'default',
      channelId: 'codetrellis-events',
    }]);
  });

  test('one per kind per minute: a second contract waits, a collision does not', async () => {
    await pushForSignal({ id: 's2', kind: 'contract', severity: 'high' });
    assert.equal(sent.length, 1);
    await pushForSignal({ id: 'c1', kind: 'collision', severity: 'high' });
    assert.equal(sent.length, 2);
    assert.equal((sent[1].body as Array<{ body: string }>)[0].body, 'Two lines of work are changing the same code.');
  });

  test('a material signal (A6.3) says what kind of overlap in its own words, naming no file', async () => {
    const before = sent.length;
    await pushForSignal({ id: 'm1', kind: 'drift', severity: 'high', subject: { material: 'data/sales.xlsx' } });
    assert.equal(sent.length, before + 1);
    const body = (sent[before].body as Array<{ body: string }>)[0].body;
    assert.equal(body, 'A task is reading a file its brief does not include.');
    assert.doesNotMatch(body, /sales/);
  });
});

describe('where pushes go', () => {
  test('Expo, unless the setting names a receiver on this machine', () => {
    assert.match(pushUrl({}), /^https:\/\/exp\.host\//);
    assert.equal(pushUrl({ CODETRELLIS_PUSH_URL: 'http://127.0.0.1:4567/push' }), 'http://127.0.0.1:4567/push');
    assert.equal(pushUrl({ CODETRELLIS_PUSH_URL: 'http://localhost/push' }), 'http://localhost/push');
    for (const off of ['https://evil.example/push', 'http://127.0.0.1.evil.example/x', 'http://10.0.0.1/push', 'file:///tmp/x']) {
      assert.match(pushUrl({ CODETRELLIS_PUSH_URL: off }), /^https:\/\/exp\.host\//, off);
    }
  });
});

describe('newly serious', () => {
  const sig = (id: string, over: Partial<AwarenessSignal> = {}): AwarenessSignal => ({
    id, kind: 'contract', severity: 'high', subject: {}, workstreams: ['/a', '/b'], summary: '', firstSeen: 1, lastSeen: 1, state: 'open', ...over,
  });

  test('new, back after resolving, reopened after an answer, or raised to high while open', () => {
    const previous = [sig('back', { state: 'resolved' }), sig('reopened', { state: 'acknowledged' }), sig('raised', { severity: 'medium' })];
    const upserts = [sig('new'), sig('back'), sig('reopened', { reopened: { from: 'acknowledged', at: 2 } }), sig('raised')];
    assert.deepEqual(newlySerious(previous, upserts, ['reopened']).map((s) => s.id), ['new', 'back', 'reopened', 'raised']);
  });

  test('not: one that keeps firing, one set aside, anything below high', () => {
    const previous = [sig('firing'), sig('aside', { state: 'intended' }), sig('seen', { state: 'acknowledged' })];
    const upserts = [sig('firing', { summary: 'moved' }), sig('aside', { state: 'intended' }), sig('seen', { state: 'acknowledged' }), sig('low', { severity: 'medium' })];
    assert.deepEqual(newlySerious(previous, upserts, []), []);
  });
});
