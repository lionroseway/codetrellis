/**
 * The window's agent events (Phase 32 B1): history recorded before it
 * connected is merged in once, in time order, and the list is capped.
 */
import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import type { AgentEvent } from '../../shared/types';
import { useAgentStore, MAX_EVENTS } from './agent-store';

const ev = (id: string, timestamp: number): AgentEvent => ({ id, timestamp, source: 'mcp', type: 'tool_call', payload: {} });

beforeEach(() => useAgentStore.getState().clearEvents());

test('history goes before what arrived live, in time order, each event once', () => {
  const s = useAgentStore.getState();
  s.pushEvent(ev('live-1', 300));
  s.loadHistory([ev('old-1', 100), ev('old-2', 200), ev('live-1', 300)]);
  s.loadHistory([ev('old-1', 100)]); // a reconnect loads it again
  assert.deepEqual(useAgentStore.getState().events.map((e) => e.id), ['old-1', 'old-2', 'live-1']);
});

test('the window holds at most MAX_EVENTS, dropping the oldest', () => {
  const s = useAgentStore.getState();
  s.loadHistory(Array.from({ length: MAX_EVENTS }, (_, i) => ev(`h-${i}`, i)));
  s.pushEvent(ev('newest', MAX_EVENTS + 1));
  const { events } = useAgentStore.getState();
  assert.equal(events.length, MAX_EVENTS);
  assert.equal(events[0].id, 'h-1');
  assert.equal(events.at(-1)!.id, 'newest');
});
