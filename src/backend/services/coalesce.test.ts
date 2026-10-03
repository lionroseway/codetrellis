import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { coalesced } from './coalesce';

/** A run that waits until released, so a test decides when each one ends. */
function controlled() {
  const started: string[] = [];
  const releases: Array<() => void> = [];
  const run = coalesced(async (key: string) => {
    const n = started.push(key);
    await new Promise<void>((resolve) => releases.push(resolve));
    return `${key}#${n}`;
  });
  const releaseNext = async () => {
    releases.shift()?.();
    // Let the settled run's continuations, and any run they start, go.
    for (let i = 0; i < 5; i++) await Promise.resolve();
  };
  return { run, started, releaseNext };
}

describe('coalesced runs', () => {
  test('one run at a time; everyone who asks meanwhile shares one run after it', async () => {
    const { run, started, releaseNext } = controlled();
    const first = run('p');
    const during = [run('p'), run('p'), run('p')];
    assert.deepEqual(started, ['p'], 'nothing else starts while the first runs');
    await releaseNext();
    assert.equal(await first, 'p#1');
    assert.deepEqual(started, ['p', 'p'], 'one follow-up for the three who asked');
    await releaseNext();
    assert.deepEqual(await Promise.all(during), ['p#2', 'p#2', 'p#2']);
  });

  test('a caller that asks during the run waits for a run that started after it asked', async () => {
    const { run, releaseNext } = controlled();
    const first = run('p');
    const late = run('p');
    let lateDone = false;
    void late.then(() => { lateDone = true; });
    await releaseNext();
    await first;
    assert.equal(lateDone, false, 'the first run read before this caller asked');
    await releaseNext();
    assert.equal(await late, 'p#2');
  });

  test('keys are independent', async () => {
    const { run, started, releaseNext } = controlled();
    const a = run('a');
    const b = run('b');
    assert.deepEqual(started, ['a', 'b']);
    await releaseNext();
    await releaseNext();
    assert.deepEqual(await Promise.all([a, b]), ['a#1', 'b#2']);
  });

  test('running() hands over the run going now, or null, and queues nothing', async () => {
    const { run, started, releaseNext } = controlled();
    assert.equal(run.running('p'), null);
    const first = run('p');
    assert.equal(run.running('p'), first);
    await releaseNext();
    await first;
    assert.equal(run.running('p'), null);
    assert.deepEqual(started, ['p']);
  });

  test('a run that fails is not left running, and the follow-up still runs', async () => {
    let n = 0;
    const run = coalesced(async () => {
      n += 1;
      if (n === 1) throw new Error('first fails');
      return n;
    });
    const first = run('p');
    const after = run('p');
    await assert.rejects(first, /first fails/);
    assert.equal(await after, 2);
    assert.equal(run.running('p'), null);
  });
});
