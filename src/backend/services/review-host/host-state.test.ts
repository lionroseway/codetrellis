/**
 * Phase 32 C2.2b — what a review host adds to git's answer, and the words.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { overlayHost } from './host-state';
import { gitStateWords, gitStateChip, sourceWords, type ItemGitState } from '../../../shared/lib/git-state-words';
import type { HostRead, HostReview } from './github';

const gh = (read: HostRead) => ({ kind: 'github' as const, read });

const git = (over: Partial<ItemGitState> = {}): ItemGitState => ({ state: 'pushed', source: 'git', branch: 'billing', base: 'main', commit: 'b'.repeat(40), at: 1_790_000_000, remote: 'origin', ...over });
const review = (over: Partial<HostReview> = {}): HostReview => ({
  number: 118, ref: '#118', url: 'https://github.com/acme/app/pull/118', state: 'open', at: null, mergeCommit: null, checks: 'passing', approvals: 1, changesRequested: false, ...over,
});
const at = Date.UTC(2026, 8, 22) / 1000;

test('nothing asked, nothing added: git\'s answer, from git', () => {
  const s = overlayHost(git(), null);
  assert.deepEqual([s.state, s.source, gitStateWords(s), sourceWords(s)], ['pushed', 'git', 'pushed, not merged', 'from git']);
});

test('an open pull request: in review, with its checks and approvals, from GitHub', () => {
  const s = overlayHost(git(), gh({ ok: true, review: review() }));
  assert.deepEqual([s.state, s.source, gitStateChip(s), sourceWords(s)], ['in-review', 'github', 'in review', 'from GitHub']);
  assert.equal(gitStateWords(s), 'in review (#118), checks passing, 1 approval');
  assert.equal(gitStateWords(overlayHost(git(), gh({ ok: true, review: review({ checks: 'failing', approvals: 0, changesRequested: true }) }))), 'in review (#118), checks failing, changes requested');
  assert.equal(gitStateWords(overlayHost(git(), gh({ ok: true, review: review({ checks: null, approvals: 2 }) }))), 'in review (#118), 2 approvals');
});

test('merged by its pull request: the number, the date and the merge commit', () => {
  const s = overlayHost(git(), gh({ ok: true, review: review({ state: 'merged', at, mergeCommit: 'c'.repeat(40) }) }));
  assert.deepEqual([s.state, s.source, s.how, s.commit], ['merged', 'github', 'pull-request', 'c'.repeat(40)]);
  assert.equal(gitStateWords(s), 'merged into main (#118, 22 Sept)');
});

test('closed without merging: only the host can say it', () => {
  const s = overlayHost(git(), gh({ ok: true, review: review({ state: 'closed', at }) }));
  assert.deepEqual([s.state, s.source], ['closed', 'github']);
  assert.equal(gitStateWords(s), 'closed without merging (#118, 22 Sept)');
});

test('where the host and git disagree, git\'s proof of a merge stands and the host is said, not dropped', () => {
  const merged = git({ state: 'merged', how: 'squash-or-rebase', commit: 'd'.repeat(40) });
  const closed = overlayHost(merged, gh({ ok: true, review: review({ state: 'closed', at }) }));
  assert.deepEqual([closed.state, closed.source, closed.hostNote], ['merged', 'git', 'GitHub says #118 was closed without merging; git shows its changes on main.']);
  const open = overlayHost(merged, gh({ ok: true, review: review() }));
  assert.deepEqual([open.state, open.hostNote], ['merged', 'GitHub still has #118 open, but its changes are on main.']);
});

test('no pull request, or GitHub not read: git\'s answer, and why the host added nothing', () => {
  assert.deepEqual([overlayHost(git(), gh({ ok: true, review: null })).state, overlayHost(git(), gh({ ok: true, review: null })).hostNote], ['pushed', 'GitHub has no pull request for this branch.']);
  const failed = overlayHost(git(), gh({ ok: false, error: 'GitHub refused the token (401). Save a new one in Settings → Review hosts.' }));
  assert.deepEqual([failed.state, failed.source, failed.hostNote], ['pushed', 'git', 'GitHub refused the token (401). Save a new one in Settings → Review hosts.']);
});

test('GitLab and Bitbucket say it in their own words, with their own source', () => {
  const mr = { ...review(), number: 42, ref: '!42', url: 'https://gitlab.com/team/app/-/merge_requests/42' };
  const lab = overlayHost(git(), { kind: 'gitlab', read: { ok: true, review: mr } });
  assert.deepEqual([lab.state, lab.source, sourceWords(lab), gitStateWords(lab)], ['in-review', 'gitlab', 'from GitLab', 'in review (!42), checks passing, 1 approval']);
  assert.equal(overlayHost(git(), { kind: 'gitlab', read: { ok: true, review: null } }).hostNote, 'GitLab has no merge request for this branch.');
  const bucket = overlayHost(git(), { kind: 'bitbucket', read: { ok: true, review: review({ state: 'closed', at }) } });
  assert.deepEqual([bucket.state, bucket.source, sourceWords(bucket), gitStateWords(bucket)], ['closed', 'bitbucket', 'from Bitbucket', 'closed without merging (#118, 22 Sept)']);
});
