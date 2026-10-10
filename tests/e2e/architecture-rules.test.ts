/**
 * Phase 32 A7.1 — architecture rules, against a real backend.
 *
 * Sam's team keeps the API's routes off the database: "services/api/app/routes/
 * may not import services/api/app/db.py, because routes go through the
 * service layer". Written today, it says the two imports that already break
 * it. A second rule keeps the web app off the services ("the web app calls
 * the API over HTTP"): an agent asking check_conformity about an import from
 * packages/web/ into services/ is told the rule and why, while an import
 * inside the web app is fine. An agent's list_rules is the window's answer.
 * Bad rules are refused with why; from plain HTTP, setting one is refused.
 */

import fs from 'node:fs';
import path from 'node:path';
import { test, expect } from '@playwright/test';
import yaml from 'yaml';
import { setupHarness, type Harness, type ScriptedAgent } from '../harness';
import type { RuleView } from '../../src/shared/types/architecture-rules';

test.describe.serial('Architecture rules', () => {
  test.setTimeout(120_000);
  let h: Harness;
  let root: string;
  let agent: ScriptedAgent;
  const rules = async () => ((await (await h.client.raw('GET', `/api/rules?project=${encodeURIComponent(root)}`)).json()) as { rules: RuleView[] }).rules;

  test.beforeAll(async () => {
    h = await setupHarness('architecture-rules');
    root = h.fixture.projectPath;
    await h.client.scanProject(root);
    agent = await h.spawnAgent({ agentType: 'claude-code' });
  });
  test.afterAll(async () => { await h?.teardown(); });

  test('written by the person, a rule is kept for the team and says what already breaks it', async () => {
    const put = await h.client.raw('PUT', `/api/rules/routes-not-db?project=${encodeURIComponent(root)}`, {
      from: 'services/api/app/routes/', mayNotImport: 'services/api/app/db.py', because: 'routes go through the service layer',
    });
    expect(put.status, await put.clone().text()).toBe(200);
    // Kept in the default suite's file, committed with the code (R1), not in the config.
    const suite = yaml.parse(fs.readFileSync(path.join(root, '.codetrellis', 'rules', 'architecture.yaml'), 'utf8')) as { suite: string; rules: Array<{ id: string; since: string }> };
    expect(suite.suite).toBe('architecture');
    expect(suite.rules.map((r) => r.id)).toEqual(['routes-not-db']);
    expect(Math.abs(Date.parse(suite.rules[0].since) - Date.now())).toBeLessThan(60_000);
    const configPath = path.join(root, '.codetrellis', 'config.json');
    expect(fs.existsSync(configPath) ? (JSON.parse(fs.readFileSync(configPath, 'utf8')) as { rules?: unknown }).rules : undefined).toBeUndefined();

    const [view] = await rules();
    expect(view.where).toBe('.codetrellis/rules/architecture.yaml');
    expect(view.rule.suite).toBe('architecture');
    // A new rule starts at warn (R4): it is said, and CI passes, until a person makes it block.
    expect(view.rule.strength).toBe('warn');
    expect(view.words).toBe('services/api/app/routes/ may not import services/api/app/db.py: routes go through the service layer');
    expect(view.breaches?.map((b) => b.from).sort()).toEqual(['services/api/app/routes/orders.py', 'services/api/app/routes/users.py']);
    expect(view.breaches?.every((b) => b.to === 'services/api/app/db.py')).toBe(true);
    expect(view.breachWords).toBe('2 imports break this today');
  });

  test('an agent asking before it writes an import is told the rule and why; an import inside the web app is fine', async () => {
    const put = await h.client.raw('PUT', `/api/rules/web-not-services?project=${encodeURIComponent(root)}`, {
      from: 'packages/web/', mayNotImport: 'services/', because: 'the web app calls the API over HTTP', strength: 'block',
    });
    expect(put.status, await put.clone().text()).toBe(200);
    const set = (await put.json()) as { view: RuleView };
    expect(set.view.breachWords).toBe('Nothing breaks this today');
    // Asked for at block (R4), it is kept at block.
    expect(set.view.rule.strength).toBe('block');

    const refused = await agent.callTool('check_conformity', { proposed_imports: [{ from: 'packages/web/src/UserList.tsx', importing: 'services/api/app/db.py' }], project_path: root });
    expect(refused.isError, refused.text).toBeFalsy();
    const r = JSON.parse(refused.answer) as { conformant: boolean; violations: Array<{ rule: string; message: string; because?: string }>; rules: number };
    expect(r).toMatchObject({ conformant: false, rules: 2 });
    expect(r.violations).toEqual([{
      rule: 'web-not-services',
      message: 'packages/web/src/UserList.tsx imports services/api/app/db.py, which the rule “packages/web/ may not import services/” forbids: the web app calls the API over HTTP',
      because: 'the web app calls the API over HTTP',
    }]);

    const fine = await agent.callTool('check_conformity', { proposed_imports: [{ from: path.join(root, 'packages/web/src/UserList.tsx'), importing: path.join(root, 'packages/web/src/api.ts') }], project_path: root });
    expect(JSON.parse(fine.answer)).toMatchObject({ conformant: true, violations: [] });
  });

  test('R3: a change is previewed against the code before it is made: what it allows, what it forbids, whether it needs confirming', async () => {
    const preview = async (id: string, body: Record<string, unknown>) => {
      const r = await h.client.raw('POST', `/api/rules/${id}/preview?project=${encodeURIComponent(root)}`, body);
      expect(r.status, await r.clone().text()).toBe(200);
      return (await r.json()) as { change: { effect: string; allowed: unknown[]; forbidden: unknown[] } | null; words: string; breaches: number | null; needsConfirm: boolean };
    };
    // Made a guide: the two imports that break it would no longer be checked.
    const guide = await preview('routes-not-db', { from: 'services/api/app/routes/', mayNotImport: 'services/api/app/db.py', strength: 'guide' });
    expect(guide).toMatchObject({ needsConfirm: true, change: { effect: 'loosens' } });
    expect(guide.words).toMatch(/^✗ This change lowers the rule routes-not-db from warn to guide\. Loosening a rule needs a person's approval in the app\.$/);
    // A new rule tightens: it says what already breaks it, and needs no confirming.
    const added = await preview('orders-not-db', { from: 'services/api/app/routes/orders.py', mayNotImport: 'services/api/app/db.py' });
    expect(added).toMatchObject({ needsConfirm: false, breaches: 1, change: { effect: 'tightens', forbidden: [{ from: 'services/api/app/routes/orders.py', to: 'services/api/app/db.py' }] } });
    // The same rule again changes nothing about how code is judged.
    expect((await preview('routes-not-db', { from: 'services/api/app/routes/', mayNotImport: 'services/api/app/db.py', because: 'routes go through the service layer' })).words)
      .toBe('This changes nothing about how code is judged.');
    // Nothing was written by looking.
    expect((await rules()).map((v) => v.rule.id).sort()).toEqual(['routes-not-db', 'web-not-services']);
    expect((await h.client.raw('POST', `/api/rules/nope/preview?project=${encodeURIComponent(root)}`, { remove: true })).status).toBe(404);
  });

  test('an agent\'s list_rules is the window\'s answer', async () => {
    const r = await agent.callTool('list_rules', { project_path: root });
    expect(r.isError, r.text).toBeFalsy();
    expect(JSON.parse(r.answer)).toEqual({ rules: await rules() });
  });

  test('a bad rule is refused with why; an unknown one cannot be stopped; a stopped one is gone from its file', async () => {
    const odd = await h.client.raw('PUT', `/api/rules/web?project=${encodeURIComponent(root)}`, { from: 'web/', mayNotImport: 'db/', strength: 'sometimes' });
    expect(odd.status).toBe(400);
    expect(((await odd.json()) as { error: string }).error).toMatch(/strength must be block, warn or guide/);
    const bad = await h.client.raw('PUT', `/api/rules/web?project=${encodeURIComponent(root)}`, { from: '../web/', mayNotImport: '' });
    expect(bad.status).toBe(400);
    expect(((await bad.json()) as { error: string }).error).toBe('from may not climb out of the project; mayNotImport must be a folder or a pattern, like web/');
    expect((await h.client.raw('DELETE', `/api/rules/nope?project=${encodeURIComponent(root)}`)).status).toBe(404);

    // R3: stopping a rule loosens it, so it is previewed and then confirmed, never by default.
    const unconfirmed = await h.client.raw('DELETE', `/api/rules/web-not-services?project=${encodeURIComponent(root)}`);
    expect(unconfirmed.status).toBe(409);
    expect(await unconfirmed.json()).toMatchObject({ needsConfirm: true, words: expect.stringMatching(/^✗ This change removes the rule “packages\/web\/ may not import services\/” \(web-not-services\)/) });
    expect((await rules()).map((v) => v.rule.id).sort()).toEqual(['routes-not-db', 'web-not-services']);
    const stopped = await h.client.raw('DELETE', `/api/rules/web-not-services?project=${encodeURIComponent(root)}&confirm=1`);
    expect(stopped.status, await stopped.clone().text()).toBe(200);
    // Signed as the person, and written beside the suites for CI to check against the base's keys.
    const { approval } = (await stopped.json()) as { approval: { file: string; how: string; as: string } };
    expect(approval.file).toMatch(/^\.codetrellis\/rules\/approvals\/web-not-services-[0-9a-f]{12}\.yaml$/);
    expect(fs.existsSync(path.join(root, approval.file))).toBe(true);
    expect((await rules()).map((v) => v.rule.id)).toEqual(['routes-not-db']);
    const suite = yaml.parse(fs.readFileSync(path.join(root, '.codetrellis', 'rules', 'architecture.yaml'), 'utf8')) as { rules: Array<{ id: string }> };
    expect(suite.rules.map((r) => r.id)).toEqual(['routes-not-db']);
    expect((await h.client.raw('GET', `/api/rules?project=${encodeURIComponent('/tmp/never-opened')}`)).ok).toBe(false);
  });

  test('a rule Phase 32 left in config.json still counts, and moves to the rules file when the person says so', async () => {
    const configPath = path.join(root, '.codetrellis', 'config.json');
    const config = fs.existsSync(configPath) ? JSON.parse(fs.readFileSync(configPath, 'utf8')) as Record<string, unknown> : {};
    config.rules = [{ id: 'web-not-db-legacy', from: 'packages/web/', mayNotImport: 'services/api/app/db.py', except: [], because: 'kept the old way', since: '2026-09-01T00:00:00.000Z', by: 'Sam' }];
    fs.writeFileSync(configPath, JSON.stringify(config, null, 2));

    // Still counts, and says where it is kept.
    await expect.poll(async () => (await h.client.raw('GET', `/api/rules?project=${encodeURIComponent(root)}`)).json(), { timeout: 10_000 })
      .toMatchObject({ inConfig: 1, problems: [] });
    const legacy = (await rules()).find((v) => v.rule.id === 'web-not-db-legacy');
    expect(legacy?.where).toBe('.codetrellis/config.json');
    expect(legacy?.rule.suite).toBeUndefined();
    const asked = await agent.callTool('check_conformity', { proposed_imports: [{ from: 'packages/web/src/UserList.tsx', importing: 'services/api/app/db.py' }], project_path: root });
    expect((JSON.parse(asked.answer) as { violations: Array<{ rule: string }> }).violations.map((v) => v.rule)).toContain('web-not-db-legacy');

    // Moved by the person: into the suite file, out of the config, kept as it was.
    const move = await h.client.raw('POST', `/api/rules/move-from-config?project=${encodeURIComponent(root)}`);
    expect(move.status, await move.clone().text()).toBe(200);
    expect(await move.json()).toEqual({ moved: ['web-not-db-legacy'], to: '.codetrellis/rules/architecture.yaml' });
    const suite = yaml.parse(fs.readFileSync(path.join(root, '.codetrellis', 'rules', 'architecture.yaml'), 'utf8')) as { rules: Array<{ id: string; by: string; since: string }> };
    expect(suite.rules.map((r) => r.id)).toEqual(['routes-not-db', 'web-not-db-legacy']);
    expect(suite.rules[1]).toMatchObject({ by: 'Sam', since: '2026-09-01T00:00:00.000Z' });
    expect((JSON.parse(fs.readFileSync(configPath, 'utf8')) as { rules?: unknown }).rules).toBeUndefined();
    const after = (await (await h.client.raw('GET', `/api/rules?project=${encodeURIComponent(root)}`)).json()) as { inConfig: number };
    expect(after.inConfig).toBe(0);
    expect((await rules()).find((v) => v.rule.id === 'web-not-db-legacy')?.where).toBe('.codetrellis/rules/architecture.yaml');
  });

  test('a suite file a person edited by hand is read as it is; a rule it gets wrong is named, not dropped silently', async () => {
    const file = path.join(root, '.codetrellis', 'rules', 'payments.yaml');
    fs.writeFileSync(file, [
      '# The payments team owns this.',
      'suite: payments',
      'rules:',
      '  - id: web-not-payments',
      '    from: packages/web/',
      '    mayNotImport: services/payments/',
      '  - id: Bad Id',
      '    from: packages/web/',
      '    mayNotImport: services/',
    ].join('\n'));
    const body = (await (await h.client.raw('GET', `/api/rules?project=${encodeURIComponent(root)}`)).json()) as { rules: RuleView[]; problems: string[] };
    expect(body.rules.find((v) => v.rule.id === 'web-not-payments')?.where).toBe('.codetrellis/rules/payments.yaml');
    expect(body.problems).toEqual(['.codetrellis/rules/payments.yaml, rule "Bad Id": id must be a short slug, like web-not-db']);
    fs.unlinkSync(file);
  });
});

test.describe.serial('Only the person sets the rules', () => {
  test.setTimeout(90_000);
  let h: Harness;

  test.beforeAll(async () => {
    h = await setupHarness('architecture-rules-grant', { env: { CODETRELLIS_ALLOW_HTTP_GRANTS: '0' } });
    await h.client.scanProject(h.fixture.projectPath);
  });
  test.afterAll(async () => { await h?.teardown(); });

  test('from plain HTTP, setting and stopping a rule are refused with where to do it; reading is not', async () => {
    const root = encodeURIComponent(h.fixture.projectPath);
    const set = await h.client.raw('PUT', `/api/rules/web-not-db?project=${root}`, { from: 'web/', mayNotImport: 'db/' });
    expect(set.status).toBe(403);
    expect(((await set.json()) as { error: string }).error).toBe('Only you can set an architecture rule — in the CodeTrellis app\'s Rules view.');
    const stop = await h.client.raw('DELETE', `/api/rules/web-not-db?project=${root}`);
    expect(stop.status).toBe(403);
    expect(((await stop.json()) as { error: string }).error).toBe('Only you can stop an architecture rule — in the CodeTrellis app\'s Rules view.');
    const move = await h.client.raw('POST', `/api/rules/move-from-config?project=${root}`);
    expect(move.status).toBe(403);
    expect(((await move.json()) as { error: string }).error).toBe('Only you can move the architecture rules — in the CodeTrellis app\'s Rules view.');
    expect((await h.client.raw('GET', `/api/rules?project=${root}`)).status).toBe(200);
  });
});
