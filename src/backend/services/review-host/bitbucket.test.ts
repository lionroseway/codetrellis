/**
 * Phase 32 C2.3 — Bitbucket's answers, summed up. Shaped as Bitbucket
 * Cloud's REST API 2.0 returns pull requests and commit statuses, trimmed to
 * the fields read.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { summariseBitbucketPull, summariseStatuses } from './bitbucket';

const pr = (over: Record<string, unknown> = {}) => ({
  id: 7, state: 'OPEN', updated_on: '2026-09-23T08:00:00.000000+00:00',
  links: { html: { href: 'https://bitbucket.org/acme/app/pull-requests/7' } },
  merge_commit: null, source: { branch: { name: 'billing' }, commit: { hash: 'abc123def456' } },
  participants: [
    { approved: true, state: 'approved', user: { account_id: 'a' } },
    { approved: false, state: 'changes_requested', user: { account_id: 'b' } },
    { approved: false, state: null, user: { account_id: 'c' } },
  ],
  ...over,
}) as Parameters<typeof summariseBitbucketPull>[0];

test('an open pull request: its build statuses and approvals', () => {
  const r = summariseBitbucketPull(pr(), { values: [{ state: 'SUCCESSFUL' }, { state: 'INPROGRESS' }] })!;
  assert.deepEqual(r, {
    number: 7, ref: '#7', url: 'https://bitbucket.org/acme/app/pull-requests/7', state: 'open', at: null, mergeCommit: null,
    checks: 'pending', approvals: 1, changesRequested: true,
  });
});

test('merged, declined and superseded; updated_on is when', () => {
  const merged = summariseBitbucketPull(pr({ state: 'MERGED', merge_commit: { hash: 'f00dfeedbeef' } }), null)!;
  assert.deepEqual([merged.state, merged.mergeCommit, merged.at, merged.approvals], ['merged', 'f00dfeedbeef', Math.floor(Date.parse('2026-09-23T08:00:00.000000+00:00') / 1000), 0]);
  assert.equal(summariseBitbucketPull(pr({ state: 'DECLINED' }), null)!.state, 'closed');
  assert.equal(summariseBitbucketPull(pr({ state: 'SUPERSEDED' }), null)!.state, 'closed');
  assert.equal(summariseBitbucketPull(null, null), null);
});

test('build statuses: any failed or stopped fails, in progress runs, all successful passes, none is none', () => {
  assert.equal(summariseStatuses({ values: [{ state: 'SUCCESSFUL' }, { state: 'FAILED' }] }), 'failing');
  assert.equal(summariseStatuses({ values: [{ state: 'STOPPED' }] }), 'failing');
  assert.equal(summariseStatuses({ values: [{ state: 'SUCCESSFUL' }] }), 'passing');
  assert.equal(summariseStatuses({ values: [] }), null);
  assert.equal(summariseStatuses(null), null);
});
