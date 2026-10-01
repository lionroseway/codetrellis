import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  branchLineageWords, itemStatuses, planStatusView, sectionStateWords, statusLine, taskStateWords,
  type PlanItemFacts,
} from './item-status';
import type { ItemGitState } from './git-state-words';

const SEP26 = Date.UTC(2026, 8, 26, 14, 2);
const sam = { by: 'Sam', byType: 'human', at: SEP26 };

const task = (uid: string, over: Partial<PlanItemFacts> = {}): PlanItemFacts => ({ uid, title: uid, kind: 'action', parentUid: null, status: 'pending', ...over });
const section = (uid: string, over: Partial<PlanItemFacts> = {}): PlanItemFacts => ({ uid, title: uid, kind: 'object', parentUid: null, ...over });
const git = (over: Partial<ItemGitState & { words: string }>): ItemGitState & { words: string } => ({
  state: 'building', source: 'git', branch: 'billing', base: 'main', commit: 'a'.repeat(40), at: 1_790_000_000, words: 'building on billing, not pushed', ...over,
});

test('a task with no branch says what the plan records, in its own words', () => {
  assert.deepEqual(taskStateWords({ status: 'pending' }), { state: 'not-started', words: 'not started' });
  assert.deepEqual(taskStateWords({ status: 'assigned', assignee: 'claude-code' }), { state: 'assigned', words: 'assigned to claude-code' });
  assert.deepEqual(taskStateWords({ status: 'in_progress', progressPercent: 40 }), { state: 'in-progress', words: 'in progress, 40%' });
  assert.deepEqual(taskStateWords({ status: 'blocked', blockedReason: 'waits on the Q3 numbers' }), { state: 'blocked', words: 'blocked: waits on the Q3 numbers' });
  assert.deepEqual(taskStateWords({ status: 'skipped' }), { state: 'skipped', words: 'skipped' });
});

test('criteria and sign-off are part of what the plan says', () => {
  assert.equal(taskStateWords({ status: 'done', criteria: { met: 3, total: 3, awaiting: 0, signedOffBy: 'Priya' } }).words, 'done, signed off by Priya');
  assert.equal(taskStateWords({ status: 'in_progress', criteria: { met: 1, total: 3, awaiting: 1, signedOffBy: null } }).words, 'in progress; 1 of 3 criteria met, 1 waiting for sign-off');
  // Met by checks alone: no person signed it, so none is named.
  assert.equal(taskStateWords({ status: 'done', criteria: { met: 2, total: 2, awaiting: 0, signedOffBy: null } }).words, 'done; 2 of 2 criteria met');
});

test('a section sums the tasks under it; one with none is context', () => {
  assert.deepEqual(sectionStateWords([]), { state: 'context', words: 'no tasks under it' });
  assert.deepEqual(sectionStateWords([{ state: 'done' }, { state: 'merged' }]), { state: 'done', words: 'all 2 tasks done' });
  assert.deepEqual(sectionStateWords([{ state: 'not-started' }, { state: 'none' }]), { state: 'not-started', words: 'none of 2 tasks started' });
  assert.deepEqual(sectionStateWords([{ state: 'done' }, { state: 'in-progress' }, { state: 'blocked' }, { state: 'skipped' }]), { state: 'blocked', words: '1 of 3 tasks done; 1 blocked' });
});

test('every item gets a state and a source: git on a branch, the plan for the rest', () => {
  const items = [
    section('Billing'),
    task('Charge in currency', { parentUid: 'Billing', status: 'in_progress', recorded: sam }),
    section('Report'),
    task('Write the board report', { parentUid: 'Report', status: 'in_progress', recorded: sam }),
    task('Check the figures', { parentUid: 'Report', status: 'done', recorded: sam }),
    section('Notes'),
  ];
  const gits = new Map([['Billing', git({})], ['Charge in currency', git({})]]);
  const s = Object.fromEntries(itemStatuses(items, gits).map((x) => [x.itemUid, x]));
  for (const x of Object.values(s)) {
    assert.ok(x.state && x.source && x.words && x.from, `${x.itemUid} has a state and a source`);
  }
  assert.equal(s['Charge in currency'].source, 'git');
  assert.equal(s['Charge in currency'].words, 'building on billing, not pushed');
  assert.equal(s['Charge in currency'].recorded, null);
  // The analyst's task has no branch: the plan's own state, with who recorded it.
  assert.equal(s['Write the board report'].source, 'plan');
  assert.equal(s['Write the board report'].from, 'from the plan');
  assert.equal(statusLine(s['Write the board report']), 'in progress — from the plan, recorded by Sam, 26 Sept');
  assert.equal(s.Report.words, '1 of 2 tasks done');
  assert.equal(s.Report.source, 'plan');
  assert.equal(s.Notes.state, 'context');
});

test('a branch git has not seen yet: the plan\'s state, saying why', () => {
  const items = [task('Refunds', { status: 'assigned', assignee: 'codex' })];
  const [s] = itemStatuses(items, new Map([['Refunds', git({ state: 'none', branch: 'refunds', words: 'no refunds branch yet' })]]));
  assert.equal(s.source, 'plan');
  assert.equal(s.branch, 'refunds');
  assert.equal(statusLine(s), 'assigned to codex — from the plan; no refunds branch yet');
});

test('with a host on, the host is the source and the lineage names the pull request', () => {
  const review = { number: 118, url: 'https://github.com/acme/app/pull/118', checks: 'passing' as const, approvals: 1, changesRequested: false };
  const g = git({ state: 'in-review', source: 'github', review, words: 'in review (#118), checks passing, 1 approval' });
  const statuses = itemStatuses([task('Billing', { status: 'in_progress' })], new Map([['Billing', g]]));
  assert.equal(statuses[0].from, 'from GitHub');
  const view = planStatusView(statuses, ['JIRA-142'], SEP26);
  assert.deepEqual(view.lineage, ['JIRA-142 → this plan → PR #118 (open)']);
  assert.equal(view.inProgress[0].words, 'in review (#118), checks passing, 1 approval');
  assert.equal(branchLineageWords({ ...g, source: 'gitlab', state: 'merged', review: { ...review, number: 42, ref: '!42' } }), 'MR !42 (merged)');
});

test('without a host, the lineage says what git proves, never a pull request', () => {
  assert.equal(branchLineageWords(git({ state: 'pushed' })), 'billing pushed');
  assert.equal(branchLineageWords(git({ state: 'merged' })), 'billing merged into main');
  assert.equal(branchLineageWords(git({})), 'billing not pushed yet');
  assert.deepEqual(planStatusView([], [], null).lineage, ['this plan']);
});

test('the view: progress, waiting on someone, under way', () => {
  const items = [
    task('a', { status: 'done' }),
    task('b', { status: 'blocked', blockedReason: 'waits on "Currency support"' }),
    task('c', { status: 'in_progress' }),
    task('d', { status: 'in_progress', criteria: { met: 0, total: 1, awaiting: 1, signedOffBy: null } }),
    task('e', { status: 'skipped' }),
    task('f'),
  ];
  const view = planStatusView(itemStatuses(items, new Map([['f', git({ state: 'merged', words: 'merged into main' })]])), [], SEP26);
  assert.deepEqual(view.progress, { done: 2, total: 5, words: '2 of 5 tasks done' });
  assert.deepEqual(view.waiting.map((w) => w.itemUid), ['b', 'd']);
  assert.deepEqual(view.inProgress.map((w) => w.itemUid), ['c']);
});
