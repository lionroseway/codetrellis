/**
 * A read that runs one at a time (Phase 32 HD4): a burst while it runs
 * becomes one more read, with the latest arguments; a failure does not stop
 * the next; every caller's promise settles once the reads it asked for have.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { singleFlight } from './single-flight';

test('a burst while a read runs becomes one more read, with the latest arguments', async () => {
  const seen: string[] = [];
  let release!: () => void;
  const held = new Promise<void>((r) => { release = r; });
  const read = singleFlight(async (who: string) => {
    seen.push(who);
    if (seen.length === 1) await held;
  });
  const first = read('a');
  const burst = ['b', 'c', 'd', 'e'].map((x) => read(x));
  release();
  await Promise.all([first, ...burst]);
  assert.deepEqual(seen, ['a', 'e']);
  // Quiet again: the next call reads at once.
  await read('f');
  assert.deepEqual(seen, ['a', 'e', 'f']);
});

test('a failed read does not stop the one asked for after it', async () => {
  const seen: number[] = [];
  let release!: () => void;
  const held = new Promise<void>((r) => { release = r; });
  const read = singleFlight(async (n: number) => {
    seen.push(n);
    if (n === 1) { await held; throw new Error('server returned 500'); }
  });
  const first = read(1);
  const second = read(2);
  release();
  await Promise.all([first, second]);
  assert.deepEqual(seen, [1, 2]);
});

test('a read that returns nothing still counts', async () => {
  let n = 0;
  const read = singleFlight(() => { n++; });
  await Promise.all([read(), read(), read()]);
  assert.equal(n, 2);
});
