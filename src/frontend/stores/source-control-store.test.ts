/**
 * Two points to compare (Phase 32 E2): "from where they split" applies only
 * when both sides are refs; a slower, earlier comparison never replaces a
 * later one; the graph's toggle follows the pair.
 */
import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { canSplit, effectiveBefore, useSourceControlStore } from './source-control-store';

const realFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = realFetch;
  useSourceControlStore.setState({ pair: null, pairResult: null, pairLoading: false, pairError: null, pairOnGraph: false });
});

test('from where they split: the merge base of two refs, and nothing else', () => {
  const refs = { before: 'commit:refs/heads/main', after: 'commit:refs/heads/billing-v2', fromSplit: true };
  assert.equal(canSplit(refs), true);
  assert.equal(effectiveBefore(refs), 'merge-base:refs/heads/main...refs/heads/billing-v2');
  assert.equal(effectiveBefore({ ...refs, fromSplit: false }), 'commit:refs/heads/main');
  // A working copy has no history to split from.
  const live = { before: 'commit:refs/heads/main', after: 'live', fromSplit: true };
  assert.equal(canSplit(live), false);
  assert.equal(effectiveBefore(live), 'commit:refs/heads/main');
  assert.equal(canSplit({ before: 'workstream:/w', after: 'commit:HEAD', fromSplit: false }), false);
});

test('a slower, earlier comparison never replaces a later one', async () => {
  const answers: Array<(body: unknown) => void> = [];
  globalThis.fetch = (async () => {
    const body = await new Promise((resolve) => answers.push(resolve));
    return new Response(JSON.stringify(body), { status: 200 });
  }) as typeof fetch;
  const s = useSourceControlStore.getState();
  const first = s.setPair('/p', { before: 'commit:HEAD', after: 'live', fromSplit: false });
  const second = s.setPair('/p', { before: 'commit:refs/tags/v1', after: 'live', fromSplit: false });
  answers[1]({ before: 'commit:refs/tags/v1', after: 'live', labels: { before: 'Tag v1', after: 'Your working copy' }, files: [], truncated: false, command: 'git diff v1', words: 'second' });
  await second;
  answers[0]({ before: 'commit:HEAD', after: 'live', labels: { before: 'Last commit', after: 'Your working copy' }, files: [], truncated: false, command: 'git diff HEAD', words: 'first' });
  await first;
  assert.equal(useSourceControlStore.getState().pairResult?.words, 'second');
});

test('the graph shows the pair only while there is one, and clearing the pair turns it off', async () => {
  globalThis.fetch = (async () => new Response(JSON.stringify({ files: [], labels: { before: 'a', after: 'b' }, words: 'w', command: null, truncated: false }), { status: 200 })) as typeof fetch;
  const s = useSourceControlStore.getState();
  s.showPairOnGraph(true);
  assert.equal(useSourceControlStore.getState().pairOnGraph, false);
  await s.setPair('/p', { before: 'commit:HEAD', after: 'live', fromSplit: false });
  s.showPairOnGraph(true);
  assert.equal(useSourceControlStore.getState().pairOnGraph, true);
  await s.setPair('/p', null);
  assert.equal(useSourceControlStore.getState().pairOnGraph, false);
});
