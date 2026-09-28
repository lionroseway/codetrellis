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
