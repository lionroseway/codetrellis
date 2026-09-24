/**
 * Phase 31 §10.3–10.4 — a criterion's state in the Brief is a glyph and
 * words, and "met" says who approved it: you, a named person, or Claude.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { briefState } from './brief-vocabulary';

test('every state has a glyph and words', () => {
  assert.deepEqual(briefState('open'), { glyph: '○', words: 'not yet' });
  assert.deepEqual(briefState('submitted'), { glyph: '◐', words: 'waiting for you' });
  assert.deepEqual(briefState('sent_back'), { glyph: '↩', words: 'sent back' });
  assert.deepEqual(briefState('stale'), { glyph: '⚠', words: 'changed since approved' });
});

test('met says who approved it', () => {
  const at = new Date(2026, 8, 24, 14, 10).getTime();
  assert.match(briefState('met', { actor: 'saif@example.com', actorType: 'human', at }, 'saif@example.com').words, /^met — you, /);
  assert.match(briefState('met', { actor: 'dana@example.com', actorType: 'human', at }, 'saif@example.com').words, /^met — dana@example\.com, /);
  assert.equal(briefState('met', { actor: 'claude-desktop', actorType: 'mcp', at }).words, 'met — approved by Claude');
  assert.equal(briefState('met').words, 'met');
});
