/**
 * Phase 32 B6.1 — one dependency rule, across plans (bug 11).
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { PlanItem } from '../../shared/types';
import { dependencyState, dependencyProblem, waitSentence, type DependencyLookup } from './plan-dependencies';

const item = (uid: string, planUid: string, over: Partial<PlanItem> = {}) =>
  ({ uid, planUid, kind: 'action', title: uid, status: 'pending', dependencies: [], ...over }) as PlanItem;

const items = new Map<string, PlanItem>([
  ['migrate', item('migrate', 'billing', { title: 'Migrate schema', status: 'in_progress' })],
  ['shipped', item('shipped', 'billing', { title: 'Ship API', status: 'done' })],
  ['skipped', item('skipped', 'billing', { title: 'Old step', status: 'skipped' })],
  ['notes', item('notes', 'billing', { kind: 'object', title: 'Design notes', status: undefined })],
  ['tests', item('tests', 'exports', { title: 'Write tests' })],
]);
const lookup: DependencyLookup = {
  getItem: (uid) => items.get(uid) ?? null,
  planTitle: (uid) => ({ billing: 'Billing v2', exports: 'Exports' } as Record<string, string>)[uid] ?? null,
};

test('a dependency in another plan is found there, and holds only until it is done', () => {
  const deploy = item('deploy', 'exports', { title: 'Deploy', dependencies: ['migrate'] });
  const held = dependencyState(deploy, lookup);
  assert.equal(held.met, false);
  assert.equal(held.waits[0].words, 'waits on "Migrate schema" in plan "Billing v2"');
  assert.equal(held.waits[0].planTitle, 'Billing v2');
  assert.equal(waitSentence('Deploy', held), '"Deploy" waits on "Migrate schema" in plan "Billing v2".');

  const done = item('deploy', 'exports', { dependencies: ['shipped', 'skipped'] });
  assert.deepEqual(dependencyState(done, lookup), { met: true, waits: [] });
});

test('a dependency in the same plan names no plan, and the local map is used first', () => {
  const local = new Map([['tests', item('tests', 'exports', { title: 'Write tests (local copy)' })]]);
  const state = dependencyState(item('ship', 'exports', { dependencies: ['tests'] }), lookup, local);
  assert.equal(state.waits[0].words, 'waits on "Write tests (local copy)"');
  assert.equal(state.waits[0].planTitle, null);
});

test('a deleted item and a page say why they hold their dependant', () => {
  const state = dependencyState(item('x', 'exports', { dependencies: ['gone', 'notes'] }), lookup);
  assert.deepEqual(state.waits.map((w) => w.problem), ['missing', 'page']);
  assert.equal(state.waits[0].words, 'waits on an item that no longer exists (gone)');
  assert.equal(state.waits[1].words, 'depends on the page "Design notes" in plan "Billing v2", which has no status to finish');
});

test('writing a dependency: any plan\'s task is allowed; nothing, itself or a page is refused', () => {
  assert.equal(dependencyProblem('deploy', ['migrate', 'tests'], lookup.getItem), null);
  assert.equal(dependencyProblem('deploy', ['deploy'], lookup.getItem), 'An item cannot depend on itself.');
  assert.equal(dependencyProblem(null, ['gone'], lookup.getItem), 'No item has the uid gone.');
  assert.match(dependencyProblem(null, ['notes'], lookup.getItem) ?? '', /"Design notes" is a page, not a task/);
});
