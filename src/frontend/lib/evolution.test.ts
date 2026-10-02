/**
 * Locked scrubbing (Phase 32 E3): moving one side puts the other where it
 * stood at the same moment.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { positionAt, timeOf } from './evolution';

const NOW = 10_000;
// Newest first: the working copy, then commits at 9000, 6000, 2000.
const side = [{ at: null }, { at: 9000 }, { at: 6000 }, { at: 2000 }];

test('a working copy stands for now; a commit for its time', () => {
  assert.equal(timeOf({ at: null }, NOW), NOW);
  assert.equal(timeOf({ at: 6000 }, NOW), 6000);
});

test('the newest position at or before the moment', () => {
  assert.equal(positionAt(side, NOW, NOW), 0);
  assert.equal(positionAt(side, 9500, NOW), 1);
  assert.equal(positionAt(side, 9000, NOW), 1);
  assert.equal(positionAt(side, 7000, NOW), 2);
  assert.equal(positionAt(side, 2000, NOW), 3);
});

test('before the side\'s history begins: its oldest position; no history: the first', () => {
  assert.equal(positionAt(side, 1000, NOW), 3);
  assert.equal(positionAt([], 1000, NOW), 0);
});
