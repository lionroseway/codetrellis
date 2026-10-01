/**
 * Phase 32 C2.3 — GitLab's answers, summed up. Shaped as GitLab's REST API
 * v4 returns merge requests and approvals, trimmed to the fields read.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { summariseMergeRequest, summarisePipeline } from './gitlab';

const mr = (over: Record<string, unknown> = {}) => ({
  iid: 42, web_url: 'https://gitlab.com/team/app/-/merge_requests/42', state: 'opened', merged_at: null, closed_at: null,
  merge_commit_sha: null, squash_commit_sha: null, source_branch: 'billing', head_pipeline: { status: 'success' },
  detailed_merge_status: 'mergeable', ...over,
}) as Parameters<typeof summariseMergeRequest>[0];

test('an open merge request: its pipeline and approvals, written !42', () => {
  const r = summariseMergeRequest(mr(), { approved_by: [{ user: { username: 'priya' } }, { user: { username: 'sam' } }] })!;
  assert.deepEqual(r, {
    number: 42, ref: '!42', url: 'https://gitlab.com/team/app/-/merge_requests/42', state: 'open', at: null, mergeCommit: null,
    checks: 'passing', approvals: 2, changesRequested: false,
  });
  assert.equal(summariseMergeRequest(mr({ detailed_merge_status: 'requested_changes' }), null)!.changesRequested, true);
});

test('merged (the squash commit when there is one) and closed; a locked one reads closed', () => {
  const merged = summariseMergeRequest(mr({ state: 'merged', merged_at: '2026-09-22T10:00:00Z', merge_commit_sha: 'm'.repeat(40), squash_commit_sha: 's'.repeat(40) }), null)!;
  assert.deepEqual([merged.state, merged.at, merged.mergeCommit, merged.checks], ['merged', Date.parse('2026-09-22T10:00:00Z') / 1000, 's'.repeat(40), null]);
  assert.equal(summariseMergeRequest(mr({ state: 'merged', merged_at: '2026-09-22T10:00:00Z', merge_commit_sha: 'm'.repeat(40) }), null)!.mergeCommit, 'm'.repeat(40));
  assert.equal(summariseMergeRequest(mr({ state: 'closed', closed_at: '2026-09-23T08:00:00Z' }), null)!.state, 'closed');
  assert.equal(summariseMergeRequest(mr({ state: 'locked' }), null)!.state, 'closed');
  assert.equal(summariseMergeRequest(null, null), null);
});

test('pipelines: success passes, failed or canceled fails, skipped is none, the rest are running', () => {
  assert.deepEqual(
    ['success', 'failed', 'canceled', 'skipped', 'running', 'pending', 'manual', 'created', null].map((s) => summarisePipeline(s)),
    ['passing', 'failing', 'failing', null, 'pending', 'pending', 'pending', 'pending', null],
  );
});
