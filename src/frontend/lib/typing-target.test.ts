/**
 * Whether a key belongs to the focused field (Phase 33 follow-up): text
 * fields keep their keys; a checkbox, a radio or a button does not, so Escape
 * after ticking a box still reaches the window.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isTypingTarget } from './typing-target';

test('text being written keeps its keys', () => {
  assert.equal(isTypingTarget({ tagName: 'TEXTAREA' }), true);
  assert.equal(isTypingTarget({ tagName: 'INPUT', type: 'text' }), true);
  assert.equal(isTypingTarget({ tagName: 'INPUT', type: 'search' }), true);
  assert.equal(isTypingTarget({ tagName: 'INPUT', type: 'number' }), true);
  assert.equal(isTypingTarget({ tagName: 'INPUT' }), true, 'an input with no type is a text field');
  assert.equal(isTypingTarget({ tagName: 'DIV', isContentEditable: true }), true);
});

test('a ticked box, a radio or a button does not: Escape after "Ask me first" still leaves the workspace', () => {
  for (const type of ['checkbox', 'radio', 'button', 'submit', 'range', 'CHECKBOX']) {
    assert.equal(isTypingTarget({ tagName: 'INPUT', type }), false, type);
  }
  assert.equal(isTypingTarget({ tagName: 'BUTTON' }), false);
  assert.equal(isTypingTarget({ tagName: 'SELECT' }), false);
  assert.equal(isTypingTarget(null), false);
});
