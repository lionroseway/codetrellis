import { test } from 'node:test';
import assert from 'node:assert/strict';
import { burst, type BurstTimers } from './burst';

/** Timers driven by the test: `advance(ms)` runs whatever falls due, in order. */
function fakeTimers(): BurstTimers & { advance(ms: number): void } {
  let now = 0;
  let next = 1;
  const due = new Map<number, { at: number; fn: () => void }>();
  return {
    now: () => now,
    set(fn, ms) { const id = next++; due.set(id, { at: now + ms, fn }); return id; },
    clear(h) { due.delete(h as number); },
    advance(ms) {
      const end = now + ms;
      for (;;) {
        const [id, t] = [...due.entries()].sort((a, b) => a[1].at - b[1].at)[0] ?? [];
        if (id === undefined || t!.at > end) break;
        due.delete(id);
        now = t!.at;
        t!.fn();
      }
      now = end;
    },
  };
}

function setup(quietMs = 250, maxWaitMs = 1000) {
  const timers = fakeTimers();
  const flushed: Array<{ key: string; items: string[]; at: number }> = [];
  const b = burst<string, string>((key, items) => flushed.push({ key, items, at: timers.now() }), { quietMs, maxWaitMs, timers });
  return { b, timers, flushed };
}

test('forty changes to one plan in a burst are handed over once, after it goes quiet', () => {
  const { b, timers, flushed } = setup();
  for (let i = 0; i < 40; i++) { b.add('plan-a', `tasks/${i}.yaml`); timers.advance(5); }
  assert.equal(flushed.length, 0, 'nothing while changes keep arriving inside the quiet window');
  timers.advance(250);
  assert.equal(flushed.length, 1);
  assert.equal(flushed[0].key, 'plan-a');
  assert.equal(flushed[0].items.length, 40);
});

test('the same file changing twice in a burst is one item', () => {
  const { b, timers, flushed } = setup();
  b.add('plan-a', 'plan.yaml');
  b.add('plan-a', 'plan.yaml');
  timers.advance(300);
  assert.deepEqual(flushed.map((f) => f.items), [['plan.yaml']]);
});

test('each plan has its own burst', () => {
  const { b, timers, flushed } = setup();
  b.add('plan-a', 'x');
  b.add('plan-b', 'y');
  b.add('plan-a', 'z');
  timers.advance(300);
  assert.deepEqual(flushed.map((f) => [f.key, f.items.sort()]).sort(), [['plan-a', ['x', 'z']], ['plan-b', ['y']]]);
});

test('a burst that never goes quiet is still handed over every maxWait, never starved', () => {
  const { b, timers, flushed } = setup(250, 1000);
  for (let t = 0; t < 2500; t += 100) { b.add('plan-a', `f${t}`); timers.advance(100); }
  timers.advance(300);
  // One at 1000 ms, one at 2000 ms, and the tail after it goes quiet.
  assert.deepEqual(flushed.map((f) => f.at), [1000, 2000, 2650]);
  assert.equal(flushed.reduce((n, f) => n + f.items.length, 0), 25, 'no change is lost between bursts');
});

test('a lone change is handed over after the quiet window, not the max wait', () => {
  const { b, timers, flushed } = setup(250, 1000);
  b.add('plan-a', 'plan.yaml');
  timers.advance(249);
  assert.equal(flushed.length, 0);
  timers.advance(1);
  assert.equal(flushed.length, 1);
  assert.equal(flushed[0].at, 250);
});

test('flush hands over now; cancel drops without handing over', () => {
  const { b, timers, flushed } = setup();
  b.add('plan-a', 'x');
  b.add('plan-b', 'y');
  b.flush('plan-a');
  assert.deepEqual(flushed.map((f) => f.key), ['plan-a']);
  assert.deepEqual(b.pending(), ['plan-b']);
  b.cancel();
  timers.advance(5000);
  assert.deepEqual(flushed.map((f) => f.key), ['plan-a'], 'a cancelled burst never fires');
  assert.deepEqual(b.pending(), []);
});
