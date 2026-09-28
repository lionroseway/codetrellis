/**
 * How the Timeline words a spec or item body edit (Phase 32 B1.2).
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { AgentEvent } from '../../shared/types';
import { phraseEvent } from './tool-phrasing';

const edit = (payload: Record<string, unknown>): AgentEvent => ({ id: 'e', timestamp: 1, source: 'app', type: 'spec_edited', payload });

test('a spec document, an item\'s description, and one re-read from the plan file', () => {
  assert.deepEqual(phraseEvent(edit({ kind: 'document', title: 'Token rotation', version: 3 })), {
    text: 'Edited the spec “Token rotation” (v3)', intent: 'write', tool: null, mutating: true,
  });
  assert.equal(phraseEvent(edit({ kind: 'item', title: 'Rotate tokens', version: 2 })).text, 'Edited the description of “Rotate tokens” (v2)');
  assert.equal(phraseEvent(edit({ kind: 'document', title: 'Spec', version: 4, authorType: 'file' })).text, 'Edited the spec “Spec” (v4), from the plan file');
  assert.equal(phraseEvent(edit({ kind: 'document' })).text, 'Edited the spec “untitled”');
});

test('a criterion approved or sent back, and a check run (B2.2)', () => {
  const ev = (type: AgentEvent['type'], payload: Record<string, unknown>): AgentEvent => ({ id: 'e', timestamp: 1, source: 'app', type, payload });
  assert.deepEqual(phraseEvent(ev('criterion_decided', { text: 'Old tokens are refused', decision: 'approved' })), {
    text: 'Approved “Old tokens are refused”', intent: 'write', tool: null, mutating: true,
  });
  const back = phraseEvent(ev('criterion_decided', { text: 'Rotation is logged', decision: 'sent_back' }));
  assert.equal(back.text, 'Sent back “Rotation is logged”');
  assert.equal(back.intent, 'error');
  assert.equal(phraseEvent(ev('check_run', { passed: 3, failed: 0 })).text, 'Checked criteria: all 3 passing');
  const failing = phraseEvent(ev('check_run', { passed: 1, failed: 2 }));
  assert.equal(failing.text, 'Checked criteria: 2 failing, 1 passing');
  assert.equal(failing.intent, 'error');
});

test('a skill loaded (C1.3)', () => {
  const ev: AgentEvent = { id: 'e', timestamp: 1, source: 'claude-code-watcher', type: 'skill_used', payload: { skill: 'pr-review' } };
  assert.deepEqual(phraseEvent(ev), { text: 'Used the pr-review skill', intent: 'read', tool: null, mutating: false });
  assert.equal(phraseEvent({ ...ev, payload: {} }).text, 'Used a skill');
});

test('a breakpoint hit and its answer, in words (B4.1)', () => {
  const hit: AgentEvent = { id: 'e', timestamp: 1, source: 'app', type: 'breakpoint_hit', payload: { action: 'claim', itemTitle: 'Partial refunds' } };
  assert.deepEqual(phraseEvent(hit), { text: 'Paused at a breakpoint before claiming “Partial refunds”', intent: 'ask', tool: null, mutating: false });
  const answer = (payload: Record<string, unknown>) => phraseEvent({ ...hit, type: 'breakpoint_answered', payload: { action: 'edit', itemTitle: 'Refunds', ...payload } });
  assert.equal(answer({ decision: 'continue', byType: 'human' }).text, 'You said continue changing “Refunds”');
  assert.equal(answer({ decision: 'steer', byType: 'human', note: 'keep the API' }).text, 'You said continue changing “Refunds”, with a steer: “keep the API”');
  assert.deepEqual(answer({ decision: 'stop', byType: 'unverified', note: 'wait for legal' }), { text: 'Someone said stop to changing “Refunds”: “wait for legal”', intent: 'error', tool: null, mutating: false });
  assert.equal(phraseEvent({ ...hit, payload: { action: 'done' } }).text, 'Paused at a breakpoint before marking done “an item”');
});

test('await_decision is a wait for a person', () => {
  const ev: AgentEvent = { id: 'e', timestamp: 1, source: 'mcp', type: 'tool_call', payload: { tool: 'await_decision', args: { ref: 'bp-1' } } };
  assert.equal(phraseEvent(ev).text, 'Waiting for a decision at a breakpoint');
  assert.equal(phraseEvent(ev).intent, 'ask');
});

test('a code breakpoint: a paused edit and a breach read differently, and a breach is never called a pause (B4.2)', () => {
  const hit: AgentEvent = { id: 'e', timestamp: 1, source: 'app', type: 'breakpoint_hit', payload: { action: 'edit_code', path: 'payments/refund.ts' } };
  assert.equal(phraseEvent(hit).text, 'Paused at a breakpoint before changing “payments/refund.ts”');
  const breach = phraseEvent({ ...hit, payload: { action: 'breach', path: 'payments/refund.ts', breach: true } });
  assert.deepEqual(breach, { text: 'Changed “payments/refund.ts” past a breakpoint: a breach, it could not be paused', intent: 'error', tool: null, mutating: true });
  assert.ok(!/paused/i.test(breach.text.replace('could not be paused', '')));
  const answer = phraseEvent({ ...hit, type: 'breakpoint_answered', payload: { action: 'breach', path: 'payments/refund.ts', breach: true, decision: 'stop', byType: 'human' } });
  assert.equal(answer.text, 'You said stop to changing “payments/refund.ts”');
  const check: AgentEvent = { id: 'e', timestamp: 1, source: 'mcp', type: 'tool_call', payload: { tool: 'check_breakpoint', args: { path: 'payments/refund.ts' } } };
  assert.equal(phraseEvent(check).text, 'Checked for a breakpoint on `payments/refund.ts`');
});
