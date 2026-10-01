import { test } from 'node:test';
import assert from 'node:assert/strict';
import { groundingLine } from './grounding-line';

test('the line names the criteria, then each grade there is, solid first', () => {
  assert.equal(groundingLine(['grounded', 'waiting', 'grounded']).words, '3 criteria · 2 grounded · 1 waiting on a person');
  assert.equal(
    groundingLine(['no_evidence', 'failing', 'changed', 'sent_back', 'waiting', 'grounded']).words,
    '6 criteria · 1 grounded · 1 waiting on a person · 1 sent back · 1 changed since · 1 failing · 1 no evidence yet',
  );
  assert.equal(groundingLine(['failing']).words, '1 criterion · 1 failing');
});

test('all grounded says so; none at all says nothing', () => {
  assert.deepEqual(
    { words: groundingLine(['grounded', 'grounded']).words, grounded: groundingLine(['grounded', 'grounded']).grounded },
    { words: '2 criteria · all grounded', grounded: true },
  );
  assert.equal(groundingLine(['grounded']).words, '1 criterion · grounded');
  assert.deepEqual(groundingLine([]), {
    words: null, total: 0, grounded: false,
    counts: { grounded: 0, waiting: 0, sent_back: 0, changed: 0, failing: 0, no_evidence: 0 },
  });
});
