/**
 * Phase 32 B6.2 — a plan's row in the stack.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { PlanItem } from '../../shared/types';
import { stackPlanOf, type StackSources } from './stack-service';

const item = (uid: string, planUid: string, over: Partial<PlanItem> = {}) =>
  ({ uid, planUid, parentUid: null, kind: 'action', title: uid, status: 'pending', dependencies: [], ...over }) as PlanItem;

const elsewhere = new Map<string, PlanItem>([
  ['migrate', item('migrate', 'billing', { title: 'Migrate schema', status: 'in_progress' })],
  ['api', item('api', 'billing', { title: 'Ship API', status: 'done' })],
]);
const sources: StackSources = {
  getItem: (uid) => elsewhere.get(uid) ?? null,
  planTitle: (uid) => (uid === 'billing' ? 'Billing v2' : null),
  planTicketKey: (uid) => (uid === 'exports' ? 'JIRA-150' : null),
  itemTicketKey: (uid) => (uid === 'deploy' ? 'JIRA-151' : null),
  waitingHits: (uid) => (uid === 'exports' ? 2 : 0),
};

const items: PlanItem[] = [
  item('section', 'exports', { kind: 'object', title: 'Rollout', status: undefined, workstream: 'exports-v1' }),
  item('build', 'exports', { parentUid: 'section', title: 'Build exporter', status: 'done', assignee: 'codex', assigneeType: 'codex', fileSpecs: [{ path: 'src/export.ts', action: 'modify' }], symbolSpecs: [{ name: 'run', kind: 'function', action: 'add', filePath: 'src/run.ts' }] }),
  item('deploy', 'exports', { parentUid: 'section', title: 'Deploy exports', dependencies: ['build', 'migrate', 'api'] }),
];

test('a plan is called by its ticket key, with progress and what waits on a person', () => {
  const row = stackPlanOf({ uid: 'exports', title: 'Exports', status: 'in_progress' }, items, sources);
  assert.equal(row.label, 'JIRA-150');
  assert.equal(row.ticketKey, 'JIRA-150');
  assert.deepEqual(row.progress, { done: 1, total: 2 });
  assert.equal(row.needsYou, 2);

  const untagged = stackPlanOf({ uid: 'other', title: 'Other work', status: 'draft' }, [], sources);
  assert.equal(untagged.label, 'Other work');
  assert.equal(untagged.ticketKey, null);
});

test('each task says who is on it, where it is worked, and what it waits on across plans', () => {
  const row = stackPlanOf({ uid: 'exports', title: 'Exports', status: 'in_progress' }, items, sources);
  const [section, build, deploy] = row.tasks;

  assert.equal(section.status, null, 'a page has no status');
  assert.equal(build.assignee, 'codex');
  assert.deepEqual(build.files, ['src/export.ts', 'src/run.ts'], 'its footprint: file specs and the files its symbols live in');
  assert.equal(build.workstream, 'exports-v1', 'inherited from the section above it');
  assert.equal(deploy.ticketKey, 'JIRA-151');

  assert.deepEqual(deploy.dependencies.map((d) => [d.uid, d.met]), [['build', true], ['migrate', false], ['api', true]]);
  const migrate = deploy.dependencies[1];
  assert.equal(migrate.planTitle, 'Billing v2');
  assert.equal(migrate.words, 'waits on "Migrate schema" in plan "Billing v2"');
  assert.equal(deploy.dependencies[2].planTitle, 'Billing v2', 'a met dependency in another plan still says where it is');
  assert.equal(deploy.dependencies[0].planTitle, null);
  assert.equal(deploy.waits, '"Deploy exports" waits on "Migrate schema" in plan "Billing v2".');
  assert.equal(build.waits, null);
});
