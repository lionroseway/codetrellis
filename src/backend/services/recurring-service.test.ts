/**
 * Phase 32 C4.1 — recurring playbooks, with the clock in the test's hands.
 *
 * Sam makes the Analysis report playbook recur every day at 09:00 (UTC),
 * carrying open tasks over. Its run is one plan per day, by an id derived
 * from the rule and the day, so starting it twice is one run. A day nobody
 * ran is missed, never back-filled. The next run carries the last one's
 * open tasks ("carried from 29 Sep"), but not one the playbook brings again.
 */

import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ct-recurring-'));
process.env.CODETRELLIS_DATA_DIR = path.join(tmp, 'data');
fs.mkdirSync(process.env.CODETRELLIS_DATA_DIR, { recursive: true });
const project = fs.realpathSync(fs.mkdtempSync(path.join(tmp, 'project-')));

let recurring: typeof import('./recurring-service');
let items: typeof import('./plan-item-service');
let plans: typeof import('./plan-service');
let scheduler: typeof import('./recurring-scheduler');

const SAM = { author: 'Sam Lee', authorType: 'human' };
const at = (iso: string) => Date.parse(iso);
const RULE = {
  id: 'daily-report', playbook: 'analysis-report', title: 'Daily report', every: 'day', at: '09:00', timeZone: 'UTC',
  carryOver: true, skills: [{ name: 'security-review', source: 'skill', required: false }],
};

before(async () => {
  const db = await import('./database');
  await db.initDatabase();
  (await import('./trusted-roots')).setActiveProjectRoot(project);
  recurring = await import('./recurring-service');
  items = await import('./plan-item-service');
  plans = await import('./plan-service');
  scheduler = await import('./recurring-scheduler');
});

after(() => {
  fs.rmSync(tmp, { recursive: true, force: true });
});

describe('a recurring playbook', () => {
  test('set by the person, it is kept in the committed config, from when it was set', () => {
    const rule = recurring.setRule(project, RULE, 'Sam Lee', at('2026-09-28T08:00:00Z'));
    assert.equal(rule.since, '2026-09-28T08:00:00.000Z');
    assert.equal(rule.by, 'Sam Lee');
    const config = JSON.parse(fs.readFileSync(path.join(project, '.codetrellis', 'config.json'), 'utf8')) as { recurring: Array<{ id: string }> };
    assert.deepEqual(config.recurring.map((r) => r.id), ['daily-report']);
    // Edited, it keeps when it was first set.
    assert.equal(recurring.setRule(project, { ...RULE, at: '09:00' }, 'Sam Lee', at('2026-09-30T08:00:00Z')).since, '2026-09-28T08:00:00.000Z');
  });

  test('a bad rule, or a playbook this project does not have, is refused with why', () => {
    assert.throws(() => recurring.setRule(project, { ...RULE, every: 'fortnight' }, 'Sam Lee'), (e: Error & { status?: number }) => e.status === 400 && /every must be day, week or month/.test(e.message));
    assert.throws(() => recurring.setRule(project, { ...RULE, id: 'other', playbook: 'no-such-playbook' }, 'Sam Lee'), /No playbook "no-such-playbook" in this project/);
    assert.throws(() => recurring.startRun(project, 'nope', SAM), (e: Error & { status?: number }) => e.status === 404);
  });

  test('started, the day\'s run is a plan from the playbook, with the rule\'s skills; started twice it is one run', () => {
    const now = at('2026-09-29T10:00:00Z');
    const first = recurring.startRun(project, 'daily-report', SAM, now);
    assert.equal(first.created, true);
    assert.equal(first.plan.title, 'Daily report — 29 Sep');
    assert.equal(first.plan.uid, recurring.runUid(project, 'daily-report', '2026-09-29'));
    assert.match(first.plan.uid, /^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    assert.deepEqual(first.info, { rule: 'daily-report', period: '2026-09-29', label: '29 Sep', previous: null, carried: [], startedBy: 'Sam Lee', startedAt: now });
    const actions = items.listAllItems(first.plan.uid).filter((i) => i.kind === 'action');
    assert.deepEqual(actions.map((a) => a.title), ['Gather', 'Analyse', 'Draft', 'Review']);
    assert.ok(actions.every((a) => (a.skills ?? []).some((s) => s.name === 'security-review')));

    const again = recurring.startRun(project, 'daily-report', SAM, at('2026-09-29T23:00:00Z'));
    assert.equal(again.created, false);
    assert.equal(again.plan.uid, first.plan.uid);
    assert.equal(items.listAllItems(first.plan.uid).filter((i) => i.kind === 'action').length, 4);
  });

  test('the next run carries the last one\'s open tasks, but not one the playbook brings again', () => {
    const last = recurring.runUid(project, 'daily-report', '2026-09-29');
    const lastActions = items.listAllItems(last).filter((i) => i.kind === 'action');
    items.updateItem(lastActions[0].uid, { status: 'done', author: 'Sam Lee', authorType: 'human' });
    items.createItem({ planUid: last, kind: 'action', title: 'Rotate the staging keys', author: 'Sam Lee', authorType: 'human' });
    items.createItem({ planUid: last, kind: 'action', title: 'Archive old logs', status: 'skipped', author: 'Sam Lee', authorType: 'human' });

    // 30 Sep nobody ran; on 1 Oct the run before it is 29 Sep's.
    const run = recurring.startRun(project, 'daily-report', SAM, at('2026-10-01T12:00:00Z'));
    assert.equal(run.plan.title, 'Daily report — 1 Oct');
    assert.equal(run.info.previous, last);
    const titles = items.listAllItems(run.plan.uid).filter((i) => i.kind === 'action').map((a) => a.title);
    assert.deepEqual(titles, ['Gather', 'Analyse', 'Draft', 'Review', 'Rotate the staging keys']);
    assert.equal(run.info.carried.length, 1);
    assert.equal(run.info.carried[0].from, '29 Sep');
    assert.equal(items.getItem(run.info.carried[0].itemUid)!.title, 'Rotate the staging keys');
    assert.deepEqual(recurring.runInfo(run.plan.uid), run.info);
  });

  test('the series: missed days shown, never back-filled; the run due now; the next one', () => {
    plans.updatePlan(recurring.runUid(project, 'daily-report', '2026-09-29'), { status: 'completed' }, 'Sam Lee', 'human');
    const [s] = recurring.seriesFor(project, at('2026-10-01T12:00:00Z'));
    assert.equal(s.words, 'every day 09:00 · skill: security-review');
    assert.deepEqual(s.runs.map((r) => r.words), ['28 Sep ✗ missed', '29 Sep ✓ done', '30 Sep ✗ missed', '1 Oct ◐ in progress', '2 Oct next, Fri 2 Oct 09:00']);
    assert.equal(s.due, null);

    // The next morning, 2 Oct's run is due and not started.
    const [t] = recurring.seriesFor(project, at('2026-10-02T09:30:00Z'));
    assert.deepEqual(t.due, { period: '2026-10-02', label: '2 Oct', since: at('2026-10-02T09:00:00Z'), words: 'Daily report is due since 09:00', dismissed: false });
    assert.equal(t.runs.at(-2)!.words, '2 Oct due since 09:00');
    // Only eight past days are shown.
    assert.equal(recurring.seriesFor(project, at('2026-10-30T12:00:00Z'))[0].runs.length, 9);
  });

  test('a rule set after this week\'s moment is not due until the next one', () => {
    recurring.setRule(project, { ...RULE, id: 'weekly-review', title: 'Weekly review', every: 'week', on: 1, carryOver: false, skills: [] }, 'Sam Lee', at('2026-10-01T12:00:00Z'));
    assert.throws(
      () => recurring.startRun(project, 'weekly-review', SAM, at('2026-10-01T13:00:00Z')),
      (e: Error & { status?: number }) => e.status === 409 && e.message === 'Weekly review is not due yet: the first run is Mon 5 Oct 09:00',
    );
    const s = recurring.seriesFor(project, at('2026-10-01T13:00:00Z')).find((x) => x.rule.id === 'weekly-review')!;
    assert.deepEqual(s.runs.map((r) => r.words), ['W41 next, Mon 5 Oct 09:00']);
    recurring.removeRule(project, 'weekly-review');
    assert.deepEqual(recurring.rulesOf(project).map((r) => r.id), ['daily-report']);
  });

  test('a run\'s id is the same for the same rule and period, and differs otherwise', () => {
    const a = recurring.runUid(project, 'daily-report', '2026-W40');
    assert.equal(recurring.runUid(project, 'daily-report', '2026-W40'), a);
    assert.notEqual(recurring.runUid(project, 'daily-report', '2026-W41'), a);
    assert.notEqual(recurring.runUid(project, 'weekly-review', '2026-W40'), a);
  });
});

describe('due runs, while the app runs and after (C4.2a)', () => {
  test('a run whose moment falls between two ticks is started by the schedule; not twice; not one due before', () => {
    const started = scheduler.startRunsDueBetween([project], at('2026-10-03T08:59:00Z'), at('2026-10-03T09:00:30Z'));
    assert.deepEqual(started.map((s) => s.run.plan.title), ['Daily report — 3 Oct']);
    assert.equal(started[0].run.info.startedBy, 'schedule');
    assert.equal(recurring.runInfo(started[0].run.plan.uid)!.startedBy, 'schedule');
    // The same window again (a slow tick): the run exists, nothing more.
    assert.deepEqual(scheduler.startRunsDueBetween([project], at('2026-10-03T08:59:00Z'), at('2026-10-03T09:01:00Z')), []);
    // 4 Oct 09:00 fell before the app's first tick at 10:00: not started, asked about instead.
    assert.deepEqual(scheduler.startRunsDueBetween([project], at('2026-10-04T10:00:00Z'), at('2026-10-04T10:01:00Z')), []);
    const [s] = recurring.seriesFor(project, at('2026-10-04T10:01:00Z'));
    assert.equal(s.due!.words, 'Daily report is due since 09:00');
    assert.equal(s.due!.dismissed, false);
  });

  test('"Not this time" is kept on this device; the run reads missed once its day ends', () => {
    assert.deepEqual(recurring.dismissDue(project, 'daily-report', 'Sam Lee', at('2026-10-04T10:05:00Z')), { period: '2026-10-04', label: '4 Oct' });
    assert.equal(recurring.seriesFor(project, at('2026-10-04T10:06:00Z'))[0].due!.dismissed, true);
    // Still due at 08:00 on 5 Oct: a day runs from 09:00 to 09:00. Past it, missed.
    assert.equal(recurring.seriesFor(project, at('2026-10-05T08:00:00Z'))[0].due!.period, '2026-10-04');
    const [next] = recurring.seriesFor(project, at('2026-10-05T09:30:00Z'));
    assert.equal(next.runs.find((r) => r.period === '2026-10-04')!.state, 'missed');
    // Nothing is due between 09:00 runs.
    assert.throws(() => recurring.dismissDue(project, 'daily-report', 'Sam Lee', at('2026-10-03T12:00:00Z')), /has no run due now/);
  });
});

describe('which series a plan is a run of (C4.2b)', () => {
  test('a run started here says which, for when, who started it, and what it carried', () => {
    const run = recurring.runUid(project, 'daily-report', '2026-10-01');
    const r = recurring.recurrenceOf(project, run, at('2026-10-05T12:00:00Z'))!;
    assert.equal(r.line, 'Daily report · 1 Oct run · started by Sam Lee · 1 task carried from 29 Sep');
    assert.equal(r.words, 'every day 09:00 · skill: security-review');
    assert.deepEqual(r.carriedTasks.map((t) => [t.title, t.from]), [['Rotate the staging keys', '29 Sep']]);
    const scheduled = recurring.recurrenceOf(project, recurring.runUid(project, 'daily-report', '2026-10-03'), at('2026-10-05T12:00:00Z'))!;
    // The schedule carried 1 Oct's open task on, as the rule says.
    assert.equal(scheduled.line, 'Daily report · 3 Oct run · started by the schedule · 1 task carried from 1 Oct');
  });

  test('a run that arrived from a teammate is recognised by its id; a plan that is no run says nothing', async () => {
    const db = await import('./database');
    const run = recurring.runUid(project, 'daily-report', '2026-09-29');
    db.getDb().run('DELETE FROM recurring_runs WHERE plan_uid = ?', [run]);
    const r = recurring.recurrenceOf(project, run, at('2026-10-05T12:00:00Z'))!;
    assert.equal(r.line, 'Daily report · 29 Sep run');
    assert.deepEqual(r.carriedTasks, []);
    assert.equal(recurring.recurrenceOf(project, '00000000-0000-4000-8000-000000000000', at('2026-10-05T12:00:00Z')), null);
  });
});
