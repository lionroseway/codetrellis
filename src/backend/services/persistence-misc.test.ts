/**
 * Session-persistence supporting tests — Plan 9.7.
 *
 * Covers:
 *   - channel-event seqnum replay (including delta-exceeds-ring → gap)
 *   - settings backwards-compat default fill (mergeWithDefaults)
 *
 * Out of scope here (deliberately):
 *   - Terminal scrollback snapshot — requires a live pty; verified by
 *     Playbook 1 in docs/SESSION-PERSISTENCE-PLAYBOOKS.md.
 *   - Power-service debounce — would require fake-timer infrastructure
 *     (a vitest install or sinon clock); the *decision* logic is fully
 *     covered by 9.3's truth-table against `evaluatePower(inputs)`.
 *   - AC gate — fully covered by 9.3.
 *
 * Run: `npm run test:unit`
 */

import { test } from 'node:test';
import { strict as assert } from 'node:assert';

import {
  _recordSeqForTests,
  _resetSeqForTests,
  getChannelEventsSinceSeq,
  getCurrentSeqHead,
} from './channel-event-service';
import { mergeWithDefaults } from './settings-service';
import { DEFAULT_SETTINGS } from '../../shared/types';
import type { ChannelEvent } from '../../shared/types';

// --- helpers ------------------------------------------------------------

function eventFixture(planUid: string, n: number): ChannelEvent {
  return {
    uid: `evt-${planUid}-${n}`,
    planUid,
    itemUid: null,
    eventType: 'weigh-in',
    payload: { message: `event ${n}` },
    author: 'test',
    authorType: 'test',
    agentModel: null,
    respondsTo: null,
    status: 'open',
    createdAt: Date.now() + n,
    updatedAt: Date.now() + n,
  };
}

// --- channel-event seqnum replay ---------------------------------------

test('getChannelEventsSinceSeq — empty plan returns no events + no gap', () => {
  _resetSeqForTests();
  const result = getChannelEventsSinceSeq('plan-A', 0, 100);
  assert.deepEqual(result.events, []);
  assert.equal(result.gap, false);
});

test('getChannelEventsSinceSeq — replays everything since sinceSeq', () => {
  _resetSeqForTests();
  const planUid = 'plan-B';
  for (let i = 1; i <= 5; i++) {
    _recordSeqForTests(eventFixture(planUid, i));
  }

  // sinceSeq=0 → everything (5 events)
  const all = getChannelEventsSinceSeq(planUid, 0);
  assert.equal(all.events.length, 5, 'should replay all 5 events');
  assert.equal(all.gap, false);
  assert.equal(all.latestSeq, 5, 'latestSeq should be 5');

  // sinceSeq=3 → only events 4 and 5
  const partial = getChannelEventsSinceSeq(planUid, 3);
  assert.equal(partial.events.length, 2);
  assert.equal(partial.events[0].uid, `evt-${planUid}-4`);
  assert.equal(partial.events[1].uid, `evt-${planUid}-5`);
  assert.equal(partial.gap, false);

  // sinceSeq=5 → caught up, no new events
  const caughtUp = getChannelEventsSinceSeq(planUid, 5);
  assert.equal(caughtUp.events.length, 0);
  assert.equal(caughtUp.gap, false);
});

test('getChannelEventsSinceSeq — gap marker when sinceSeq predates ring', () => {
  _resetSeqForTests();
  const planUid = 'plan-C';
  // Push more than the ring capacity (500). We push 600, ring evicts
  // the first 100 — so seqs 1..100 are gone.
  for (let i = 1; i <= 600; i++) {
    _recordSeqForTests(eventFixture(planUid, i));
  }

  // sinceSeq=50 predates the ring → gap:true, no events (client must
  // fall back to a full createdAt-based refresh).
  const gapped = getChannelEventsSinceSeq(planUid, 50);
  assert.equal(gapped.gap, true, 'should signal gap');
  assert.equal(gapped.events.length, 0, 'gap means no incremental events');

  // sinceSeq=550 is well inside the ring → 50 events replayed.
  const safe = getChannelEventsSinceSeq(planUid, 550);
  assert.equal(safe.gap, false);
  assert.equal(safe.events.length, 50);
});

test('getChannelEventsSinceSeq — respects limit', () => {
  _resetSeqForTests();
  const planUid = 'plan-D';
  for (let i = 1; i <= 10; i++) {
    _recordSeqForTests(eventFixture(planUid, i));
  }

  const limited = getChannelEventsSinceSeq(planUid, 0, 3);
  assert.equal(limited.events.length, 3, 'limit honored');
  assert.equal(limited.events[0].uid, `evt-${planUid}-1`);
});

test('getChannelEventsSinceSeq — multiple plans isolated', () => {
  _resetSeqForTests();
  for (let i = 1; i <= 3; i++) _recordSeqForTests(eventFixture('plan-E', i));
  for (let i = 1; i <= 2; i++) _recordSeqForTests(eventFixture('plan-F', i));

  const eEvents = getChannelEventsSinceSeq('plan-E', 0);
  const fEvents = getChannelEventsSinceSeq('plan-F', 0);

  assert.equal(eEvents.events.length, 3);
  assert.equal(fEvents.events.length, 2);
  for (const ev of eEvents.events) assert.equal(ev.planUid, 'plan-E');
  for (const ev of fEvents.events) assert.equal(ev.planUid, 'plan-F');
});

test('getCurrentSeqHead — reflects latest assigned seqnum', () => {
  _resetSeqForTests();
  assert.equal(getCurrentSeqHead(), 0, 'pristine state');

  _recordSeqForTests(eventFixture('plan-G', 1));
  _recordSeqForTests(eventFixture('plan-G', 2));
  _recordSeqForTests(eventFixture('plan-H', 3));

  // 3 events posted — head should be 3 (monotonic counter is global).
  assert.equal(getCurrentSeqHead(), 3);
});

// --- settings backwards-compat default fill -----------------------------

test('mergeWithDefaults — empty input fills every section', () => {
  const merged = mergeWithDefaults({});
  // Every section present and equal to the canonical defaults
  assert.deepEqual(merged.identity, DEFAULT_SETTINGS.identity);
  assert.deepEqual(merged.mcp, DEFAULT_SETTINGS.mcp);
  assert.deepEqual(merged.plans, DEFAULT_SETTINGS.plans);
  assert.deepEqual(merged.data, DEFAULT_SETTINGS.data);
  assert.deepEqual(merged.device, DEFAULT_SETTINGS.device);
  assert.deepEqual(merged.power, DEFAULT_SETTINGS.power);
  assert.equal(merged.firstRunComplete, DEFAULT_SETTINGS.firstRunComplete);
});

test('mergeWithDefaults — old settings file without power section gets defaults', () => {
  // Simulates an older settings.json that pre-dates Plan 1.1
  const legacy = {
    identity: { displayName: 'Saif', email: 'saif@ailar.ai' },
    mcp: { port: 19432, autodetectOnCollision: true },
    plans: { defaultVisibility: 'shared', attachmentLocation: 'project' },
    data: { dataDirOverride: '', personalSyncPath: '', personalSyncMode: 'none' },
    device: { deviceName: '', advertise: true, shareAudio: false, mobileApiPort: 19480 },
    firstRunComplete: true,
    updatedAt: '2026-01-01T00:00:00.000Z',
  };
  const merged = mergeWithDefaults(legacy);
  // Preserves the legacy fields…
  assert.equal(merged.identity.email, 'saif@ailar.ai');
  assert.equal(merged.firstRunComplete, true);
  // …and fills the new `power` section with documented defaults.
  assert.deepEqual(merged.power, DEFAULT_SETTINGS.power);
});

test('mergeWithDefaults — partial power section preserves what was set', () => {
  const merged = mergeWithDefaults({
    power: {
      triggers: { whileMobileConnected: true },
      // preventLidCloseSleep + onlyWhenOnAC + remaining triggers absent
    },
  });
  assert.equal(merged.power.triggers.whileMobileConnected, true, 'specified field kept');
  assert.equal(merged.power.triggers.whileAgentActive, false, 'missing field defaulted to false');
  assert.equal(merged.power.triggers.always, false);
  assert.equal(merged.power.preventLidCloseSleep, DEFAULT_SETTINGS.power.preventLidCloseSleep);
  assert.equal(merged.power.onlyWhenOnAC, DEFAULT_SETTINGS.power.onlyWhenOnAC);
});

test('mergeWithDefaults — wrong-typed fields fall back to defaults', () => {
  const merged = mergeWithDefaults({
    mcp: { port: 'not a number' as unknown as number, autodetectOnCollision: 'yes' as unknown as boolean },
    power: {
      triggers: { whileMobileConnected: 'true' as unknown as boolean },
      onlyWhenOnAC: 1 as unknown as boolean,
    },
  });
  assert.equal(merged.mcp.port, DEFAULT_SETTINGS.mcp.port);
  assert.equal(merged.mcp.autodetectOnCollision, DEFAULT_SETTINGS.mcp.autodetectOnCollision);
  assert.equal(merged.power.triggers.whileMobileConnected, DEFAULT_SETTINGS.power.triggers.whileMobileConnected);
  assert.equal(merged.power.onlyWhenOnAC, DEFAULT_SETTINGS.power.onlyWhenOnAC);
});

test('mergeWithDefaults — null/garbage input falls all the way back', () => {
  assert.deepEqual(mergeWithDefaults(null), { ...DEFAULT_SETTINGS });
  assert.deepEqual(mergeWithDefaults('garbage'), { ...DEFAULT_SETTINGS });
  assert.deepEqual(mergeWithDefaults(42), { ...DEFAULT_SETTINGS });
});
