/**
 * Phase 32 C2.2b — GitHub's answers, summed up. The answers are shaped as
 * GitHub's REST API returns them (pulls, check-runs, combined status,
 * reviews), trimmed to the fields read.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { summariseChecks, summarisePull, summariseReviews } from './github';

const pull = (over: Record<string, unknown> = {}) => ({
  number: 118, html_url: 'https://github.com/acme/app/pull/118', state: 'open', merged_at: null, closed_at: null,
  merge_commit_sha: null, head: { sha: 'a'.repeat(40), ref: 'billing' }, ...over,
}) as Parameters<typeof summarisePull>[0];
const run = (status: string, conclusion: string | null) => ({ status, conclusion });

test('an open pull request: its checks and reviews, summed up', () => {
  const r = summarisePull(pull(),
    { total_count: 2, check_runs: [run('completed', 'success'), run('completed', 'skipped')] },
    { state: 'pending', total_count: 0 },
    [{ user: { login: 'priya' }, state: 'CHANGES_REQUESTED' }, { user: { login: 'priya' }, state: 'APPROVED' }, { user: { login: 'sam' }, state: 'COMMENTED' }])!;
  assert.deepEqual(r, {
    number: 118, url: 'https://github.com/acme/app/pull/118', state: 'open', at: null, mergeCommit: null,
    checks: 'passing', approvals: 1, changesRequested: false,
  });
});

test('merged and closed: when, and the merge commit; no checks asked', () => {
  const merged = summarisePull(pull({ state: 'closed', merged_at: '2026-09-22T10:00:00Z', closed_at: '2026-09-22T10:00:00Z', merge_commit_sha: 'f'.repeat(40) }), null, null, [])!;
  assert.deepEqual([merged.state, merged.at, merged.mergeCommit, merged.checks], ['merged', Date.parse('2026-09-22T10:00:00Z') / 1000, 'f'.repeat(40), null]);
  const closed = summarisePull(pull({ state: 'closed', closed_at: '2026-09-23T08:00:00Z' }), null, null, [])!;
  assert.deepEqual([closed.state, closed.at, closed.mergeCommit], ['closed', Date.parse('2026-09-23T08:00:00Z') / 1000, null]);
  assert.equal(summarisePull(null, null, null, []), null);
});

test('checks: any failure fails, anything unfinished is running, none is none; legacy statuses count', () => {
  assert.equal(summariseChecks({ total_count: 2, check_runs: [run('completed', 'success'), run('completed', 'failure')] }, null), 'failing');
  assert.equal(summariseChecks({ total_count: 2, check_runs: [run('completed', 'success'), run('in_progress', null)] }, null), 'pending');
  assert.equal(summariseChecks({ total_count: 0, check_runs: [] }, { state: 'pending', total_count: 0 }), null);
  assert.equal(summariseChecks({ total_count: 0, check_runs: [] }, { state: 'failure', total_count: 1 }), 'failing');
  assert.equal(summariseChecks({ total_count: 1, check_runs: [run('completed', 'timed_out')] }, null), 'failing');
});

test('reviews: each reviewer\'s latest word counts once; comments do not count', () => {
  assert.deepEqual(summariseReviews([
    { user: { login: 'a' }, state: 'APPROVED' },
    { user: { login: 'b' }, state: 'APPROVED' },
    { user: { login: 'b' }, state: 'CHANGES_REQUESTED' },
    { user: { login: 'c' }, state: 'COMMENTED' },
    { user: null, state: 'APPROVED' },
  ]), { approvals: 1, changesRequested: true });
});
