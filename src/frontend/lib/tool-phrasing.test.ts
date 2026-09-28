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
