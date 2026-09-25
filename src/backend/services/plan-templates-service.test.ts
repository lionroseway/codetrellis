/**
 * Phase 31 §14 — playbooks: a template brings its criteria with it.
 *
 * What has to hold: a template's criteria arrive on the items it creates,
 * with its placeholders filled; a template is a file, so it cannot leave
 * anything but a `code` criterion to the agent; it never brings a decision;
 * "Start from a template" fills the plan it is on and takes the project
 * from that plan; and a plan published as a template carries its criteria's
 * words, not the decisions taken on them.
 */

import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { parse as parseYaml } from 'yaml';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ct-playbooks-'));
process.env.CODETRELLIS_DATA_DIR = path.join(tmp, 'data');
fs.mkdirSync(process.env.CODETRELLIS_DATA_DIR, { recursive: true });
const project = fs.realpathSync(fs.mkdtempSync(path.join(tmp, 'project-')));

let db: typeof import('./database');
let templates: typeof import('./plan-templates');
let apply: typeof import('./plan-templates-service');
let criteria: typeof import('./criteria-service');
let items: typeof import('./plan-item-service');
let publish: typeof import('./plan-template-publish-service');
let hd: typeof import('./human-decision');

let n = 0;
function newPlan(title = 'Playbook plan'): string {
  const uid = `9b1a0000-0000-4000-8000-${String(++n).padStart(12, '0')}`;
  const now = Date.now();
  db.getDb().run(
    `INSERT INTO plans (uid, title, status, author, author_type, project_path, created_at, updated_at)
     VALUES (?, ?, 'draft', 't', 'human', ?, ?, ?)`,
    [uid, title, project, now, now],
  );
  return uid;
}

before(async () => {
  db = await import('./database');
  await db.initDatabase();
  (await import('./trusted-roots')).setActiveProjectRoot(project);
  templates = await import('./plan-templates');
  apply = await import('./plan-templates-service');
  criteria = await import('./criteria-service');
  items = await import('./plan-item-service');
  publish = await import('./plan-template-publish-service');
  hd = await import('./human-decision');
});

after(() => {
  fs.rmSync(tmp, { recursive: true, force: true });
});

describe('analysis-report', () => {
  test('is listed, with its items and criteria counted', () => {
    const listed = templates.listTemplates(project).find((t) => t.id === 'analysis-report');
    assert.ok(listed, 'the playbook is a backend template, so every picker lists it');
    assert.equal(listed!.itemCount, 6);
    assert.equal(listed!.criteriaCount, 6);
  });

  test('fills an empty plan: a guide, the materials, four steps — and each kind of criterion once', () => {
    const plan = newPlan();
    const result = apply.applyTemplateToPlan({
      planUid: plan, templateId: 'analysis-report', placeholderValues: { report: 'Board pack', period: 'Q3 2026' },
    });
    assert.equal(result.version, 2);
    assert.deepEqual(
      result.items.map((i) => `${i.kind}:${i.title}`),
      ['object:Guide — how we do the Board pack', 'object:Materials', 'action:Gather', 'action:Analyse', 'action:Draft', 'action:Review'],
    );

    const all = result.items.flatMap((i) => criteria.listCriteria(i.uid));
    assert.deepEqual([...new Set(all.map((c) => c.kind))].sort(), ['artefact', 'citation', 'code', 'manual', 'test']);
    assert.ok(all.some((c) => c.text === 'Every source file used for Q3 2026 is recorded as a material'), 'placeholders reach the criteria');
    assert.ok(all.every((c) => c.state === 'open'), 'a template never brings a decision');
    assert.ok(all.every((c) => c.authorType === 'template' && c.source === 'template'));

    const policyOf = (kind: string) => all.find((c) => c.kind === kind)!.policy;
    assert.equal(policyOf('code'), 'agent', 'only code is left to the agent');
    assert.equal(policyOf('test'), 'propose');
    assert.equal(policyOf('manual'), 'human');
  });

  test('will not fill a plan that already has items', () => {
    const plan = newPlan();
    items.createItem({ planUid: plan, kind: 'action', title: 'Already here', author: 't', authorType: 'human' });
    assert.throws(() => apply.applyTemplateToPlan({ planUid: plan, templateId: 'refactor' }), /already has items/);
  });
});

describe('a template is a file', () => {
  test('it cannot leave a non-code criterion to the agent, and a row with no words is skipped', () => {
    const plan = newPlan();
    const item = items.createItem({ planUid: plan, kind: 'action', title: 'Step', author: 't', authorType: 'human' });
    const seeded = criteria.seedTemplateCriteria(item.uid, [
      { text: 'Tests pass', kind: 'test', policy: 'agent' },
      { text: 'Compiles', kind: 'code', policy: 'agent' },
      { text: '   ' },
      'A plain string is a manual criterion',
      { text: 'Unknown kind falls back', kind: 'nonsense' },
    ], 'custom');
    assert.equal(seeded, 4);
    const got = Object.fromEntries(criteria.listCriteria(item.uid).map((c) => [c.text, `${c.kind}/${c.policy}`]));
    assert.deepEqual(got, {
      'Tests pass': 'test/propose',
      Compiles: 'code/agent',
      'A plain string is a manual criterion': 'manual/human',
      'Unknown kind falls back': 'manual/human',
    });
  });

  test('a legacy template fills an existing plan too, through the same migrator', () => {
    const plan = newPlan();
    const result = apply.applyTemplateToPlan({ planUid: plan, templateId: 'perf-pass' });
    assert.equal(result.version, 1);
    assert.ok(result.items.length > 0, 'phases and docs become items the workspace can render');
  });
});

describe('publishing a plan as a playbook', () => {
  test('carries each criterion\'s words, kind and policy — never the decision taken on it', () => {
    const plan = newPlan('Monthly close');
    const step = items.createItem({ planUid: plan, kind: 'action', title: 'Reconcile', author: 't', authorType: 'human' });
    const person = hd.issueHumanDecision('desktop', 'analyst@example.com');
    const c = criteria.addCriterionAsHuman(step.uid, { text: 'Bank balances tie to statements', kind: 'artefact', policy: 'human' }, person);
    criteria.decideCriterion(c.uid, { decision: 'approved' }, person);

    const published = publish.publishPlanAsTemplate({ planUid: plan, projectRoot: project, templateId: 'monthly-close', label: 'Monthly close' });
    const yaml = parseYaml(fs.readFileSync(path.join(published.templateDir, 'template.yaml'), 'utf-8'));
    const reconcile = (yaml.items as Array<{ title: string; criteria?: unknown[] }>).find((i) => i.title === 'Reconcile');
    assert.deepEqual(reconcile?.criteria, [{ text: 'Bank balances tie to statements', kind: 'artefact', policy: 'human' }]);
    assert.doesNotMatch(fs.readFileSync(path.join(published.templateDir, 'template.yaml'), 'utf-8'), /approved|analyst@example\.com/);

    // And the next plan started from it has the criterion, open, as strict as before.
    const next = newPlan('Next month');
    const applied = apply.applyTemplateToPlan({ planUid: next, templateId: 'monthly-close' });
    const again = criteria.listCriteria(applied.items.find((i) => i.title === 'Reconcile')!.uid);
    assert.deepEqual(again.map((x) => [x.text, x.policy, x.state]), [['Bank balances tie to statements', 'human', 'open']]);
  });
});
