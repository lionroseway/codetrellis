/**
 * The test clock (Phase 32 B10.5): moved, both ways of reading the time
 * agree; unset or malformed, nothing moves.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { clockOffsetMs, moveClock } from './test-clock';

const DAY = 24 * 60 * 60 * 1000;

test('unset, malformed or zero, the clock is not moved', () => {
  assert.equal(clockOffsetMs({}), 0);
  assert.equal(clockOffsetMs({ CODETRELLIS_CLOCK_OFFSET_MS: 'soon' }), 0);
  assert.equal(clockOffsetMs({ CODETRELLIS_CLOCK_OFFSET_MS: '1e9' }), 0);
  assert.equal(clockOffsetMs({ CODETRELLIS_CLOCK_OFFSET_MS: String(120 * DAY) }), 120 * DAY);
  const before = Date;
  moveClock(0)();
  assert.equal(Date, before);
});

test('moved, Date.now() and new Date() both read the moved clock; a given time is untouched; put back, it is real again', () => {
  const real = Date.now();
  const restore = moveClock(120 * DAY);
  try {
    assert.ok(Math.abs(Date.now() - (real + 120 * DAY)) < 5_000);
    assert.ok(Math.abs(new Date().getTime() - (real + 120 * DAY)) < 5_000);
    assert.equal(new Date(0).toISOString(), '1970-01-01T00:00:00.000Z');
    assert.equal(new Date('2026-03-02T09:00:00Z').getTime(), Date.UTC(2026, 2, 2, 9));
    assert.ok(new Date() instanceof Date);
  } finally {
    restore();
  }
  assert.ok(Math.abs(Date.now() - real) < 5_000);
});
