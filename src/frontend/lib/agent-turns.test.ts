/**
 * Unit tests for turn grouping and event phrasing (Phase 22).
 *
 * Both modules are pure, so they are testable without a backend or a
 * browser — which matters, because the behaviour they encode ("does this
 * read as a sentence", "did two agents get mixed up") is exactly the kind
 * that silently regresses in a component.
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import type { AgentEvent } from '../../shared/types';
import { groupIntoTurns, formatDuration, formatRelative, TURN_GAP_MS } from './agent-turns';
import { phraseEvent } from './tool-phrasing';

let seq = 0;
const toolCall = (
  tool: string,
  args: Record<string, unknown>,
  atMs: number,
  sessionId = 's1',
  extra: Record<string, unknown> = {},
): AgentEvent => ({
  id: `e${++seq}`,
  timestamp: atMs,
  source: 'mcp',
  type: 'tool_call',
  payload: { tool, args: JSON.stringify(args), sessionId, agentType: 'claude-code', ...extra },
});

describe('phrasing', () => {
  test('a status change reads as a sentence, not JSON', () => {
    const p = phraseEvent(toolCall('update_item', { uid: 'itm_4f3a', title: 'Add refresh-token rotation', status: 'in_progress' }, 0));
    assert.equal(p.text, 'Started "Add refresh-token rotation"');
    assert.equal(p.mutating, true);
  });

  test('an opaque uid does not end up quoted in the sentence', () => {
    const p = phraseEvent(toolCall('update_item', { uid: 'itm_4f3a9c2b1d', status: 'done' }, 0));
    // No title available — the uid is truncated rather than presented as
    // if it were a name.
    assert.match(p.text, /^Finished itm_4f3a9c2b…$/);
  });

  test('a question to the human is phrased as one', () => {
    const p = phraseEvent(
      toolCall('post_channel_event', { event_type: 'need-decision', message: 'Token TTL: 15m or 1h?' }, 0),
    );
    assert.equal(p.intent, 'ask');
    assert.match(p.text, /^Asked for a decision: Token TTL/);
  });

  test('a tool error says what failed', () => {
    const e = toolCall('claim_item', { uid: 'itm_1' }, 0);
    e.type = 'tool_error';
    e.payload.error = 'already claimed by another agent';
    const p = phraseEvent(e);
    assert.equal(p.intent, 'error');
    assert.match(p.text, /Claim item failed: already claimed/);
  });

  test('an unknown tool degrades to a readable name, never raw JSON', () => {
    const p = phraseEvent(toolCall('some_future_tool', { a: 1 }, 0));
    assert.equal(p.text, 'Some future tool');
    assert.ok(!p.text.includes('{'), 'must not fall back to JSON');
  });

  test('unparseable args do not throw', () => {
    const e = toolCall('update_item', {}, 0);
    e.payload.args = '{"uid":"itm_1","status":"in_p';  // truncated by summarizeArgs
    assert.doesNotThrow(() => phraseEvent(e));
  });

  test('Claude Code session events are phrased too', () => {
    const base = { id: 'x', timestamp: 0, source: 'claude-code-watcher' as const, type: 'file_changed' as const };
    assert.equal(phraseEvent({ ...base, payload: { action: 'edit', file: 'src/auth/session.ts' } }).text, 'Edited session.ts');
    assert.equal(phraseEvent({ ...base, payload: { action: 'bash', command: 'npm test' } }).text, 'Ran `npm test`');
  });
});

describe('grouping', () => {
  test('consecutive calls become one turn', () => {
    const turns = groupIntoTurns([
      toolCall('get_item', { uid: 'itm_1' }, 1000),
      toolCall('search_symbols', { query: 'validateToken' }, 3000),
      toolCall('update_item', { title: 'Rotate keys', status: 'in_progress' }, 5000),
    ]);
    assert.equal(turns.length, 1);
    assert.equal(turns[0].events.length, 3);
    assert.equal(turns[0].durationMs, 4000);
  });

  test('a gap longer than the threshold starts a new turn', () => {
    const turns = groupIntoTurns([
      toolCall('get_item', { uid: 'itm_1' }, 0),
      toolCall('get_item', { uid: 'itm_2' }, TURN_GAP_MS + 1),
    ]);
    assert.equal(turns.length, 2);
  });

  test('concurrent agents never cross-attribute', () => {
    // This has been a real bug in the MCP server (see the comment on
    // inferAgentFromSession), so it gets a standing test.
    const turns = groupIntoTurns([
      toolCall('get_item', { uid: 'a' }, 1000, 'session-a'),
      toolCall('get_item', { uid: 'b' }, 1500, 'session-b'),
      toolCall('update_item', { title: 'A work', status: 'done' }, 2000, 'session-a'),
      toolCall('update_item', { title: 'B work', status: 'done' }, 2500, 'session-b'),
    ]);
    assert.equal(turns.length, 2);
    const a = turns.find((t) => t.sessionId === 'session-a')!;
    const b = turns.find((t) => t.sessionId === 'session-b')!;
    assert.equal(a.events.length, 2);
    assert.equal(b.events.length, 2);
    assert.match(a.summary, /A work/);
    assert.match(b.summary, /B work/);
  });

  test('out-of-order input still groups correctly', () => {
    const turns = groupIntoTurns([
      toolCall('update_item', { title: 'Second', status: 'done' }, 5000),
      toolCall('get_item', { uid: 'itm_1' }, 1000),
    ]);
    assert.equal(turns.length, 1);
    assert.equal(turns[0].startedAt, 1000);
  });

  test('an empty stream yields no turns', () => {
    assert.deepEqual(groupIntoTurns([]), []);
  });
});

describe('turn headlines', () => {
  test('a mutation outranks the reads that led to it', () => {
    const turns = groupIntoTurns([
      toolCall('get_item', { uid: 'itm_1' }, 0),
      toolCall('search_symbols', { query: 'x' }, 1000),
      toolCall('update_item', { title: 'Rotate keys', status: 'in_progress' }, 2000),
      toolCall('get_plan', { plan_uid: 'pln_1' }, 3000),
    ]);
    assert.match(turns[0].summary, /^Started "Rotate keys"/);
    assert.match(turns[0].summary, /4 calls/);
    assert.equal(turns[0].mutating, true);
  });

  test('an error outranks everything, because it is what needs seeing', () => {
    const err = toolCall('claim_item', { uid: 'itm_1' }, 2000);
    err.type = 'tool_error';
    err.payload.error = 'conflict';
    const turns = groupIntoTurns([
      toolCall('update_item', { title: 'Work', status: 'in_progress' }, 1000),
      err,
    ]);
    assert.match(turns[0].summary, /^Claim item failed/);
    assert.equal(turns[0].hasError, true);
  });

  test('a question to the human outranks a mutation', () => {
    const turns = groupIntoTurns([
      toolCall('update_item', { title: 'Work', status: 'in_progress' }, 1000),
      toolCall('post_channel_event', { event_type: 'need-decision', message: 'which one?' }, 2000),
    ]);
    assert.match(turns[0].summary, /^Asked for a decision/);
  });

  test('a read-only turn says what it looked at', () => {
    const turns = groupIntoTurns([toolCall('search_symbols', { query: 'validateToken' }, 0)]);
    assert.equal(turns[0].summary, 'Looked for `validateToken`');
    assert.equal(turns[0].mutating, false);
  });

  test('multiple mutations name the last and count the rest', () => {
    const turns = groupIntoTurns([
      toolCall('add_item', { title: 'One' }, 0),
      toolCall('add_item', { title: 'Two' }, 1000),
      toolCall('add_item', { title: 'Three' }, 2000),
    ]);
    assert.match(turns[0].summary, /^Added "Three" \(\+2 more\)/);
  });
});

describe('formatting', () => {
  test('durations', () => {
    assert.equal(formatDuration(0), '—');
    assert.equal(formatDuration(41_000), '41s');
    assert.equal(formatDuration(125_000), '2m 05s');
  });

  test('relative times', () => {
    const now = 1_000_000_000;
    assert.equal(formatRelative(now - 5_000, now), 'just now');
    assert.equal(formatRelative(now - 4 * 60_000, now), '4 minutes ago');
    assert.equal(formatRelative(now - 60 * 60_000, now), '1 hour ago');
    assert.equal(formatRelative(now - 48 * 60 * 60_000, now), '2 days ago');
  });
});
