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
    const config = JSON.parse(fs.readFileSync(path.join(root, '.codetrellis', 'config.json'), 'utf8')) as { rules: Array<{ id: string; since: string }> };
    expect(config.rules.map((r) => r.id)).toEqual(['routes-not-db']);
    expect(Math.abs(Date.parse(config.rules[0].since) - Date.now())).toBeLessThan(60_000);

    const [view] = await rules();
    expect(view.words).toBe('services/api/app/routes/ may not import services/api/app/db.py: routes go through the service layer');
    expect(view.breaches?.map((b) => b.from).sort()).toEqual(['services/api/app/routes/orders.py', 'services/api/app/routes/users.py']);
    expect(view.breaches?.every((b) => b.to === 'services/api/app/db.py')).toBe(true);
    expect(view.breachWords).toBe('2 imports break this today');
  });

  test('an agent asking before it writes an import is told the rule and why; an import inside the web app is fine', async () => {
    const put = await h.client.raw('PUT', `/api/rules/web-not-services?project=${encodeURIComponent(root)}`, {
      from: 'packages/web/', mayNotImport: 'services/', because: 'the web app calls the API over HTTP',
    });
    expect(put.status, await put.clone().text()).toBe(200);
    expect(((await put.json()) as { view: RuleView }).view.breachWords).toBe('Nothing breaks this today');

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

  test('an agent\'s list_rules is the window\'s answer', async () => {
    const r = await agent.callTool('list_rules', { project_path: root });
    expect(r.isError, r.text).toBeFalsy();
    expect(JSON.parse(r.answer)).toEqual({ rules: await rules() });
  });

  test('a bad rule is refused with why; an unknown one cannot be stopped; a stopped one is gone from the config', async () => {
    const bad = await h.client.raw('PUT', `/api/rules/web?project=${encodeURIComponent(root)}`, { from: '../web/', mayNotImport: '' });
    expect(bad.status).toBe(400);
    expect(((await bad.json()) as { error: string }).error).toBe('from may not climb out of the project; mayNotImport must be a folder or a pattern, like web/');
    expect((await h.client.raw('DELETE', `/api/rules/nope?project=${encodeURIComponent(root)}`)).status).toBe(404);

    expect((await h.client.raw('DELETE', `/api/rules/web-not-services?project=${encodeURIComponent(root)}`)).status).toBe(200);
    expect((await rules()).map((v) => v.rule.id)).toEqual(['routes-not-db']);
    expect((await h.client.raw('GET', `/api/rules?project=${encodeURIComponent('/tmp/never-opened')}`)).ok).toBe(false);
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
    expect(((await set.json()) as { error: string }).error).toBe('Only you can set an architecture rule — in the CodeTrellis app, Settings → Architecture rules.');
    const stop = await h.client.raw('DELETE', `/api/rules/web-not-db?project=${root}`);
    expect(stop.status).toBe(403);
    expect(((await stop.json()) as { error: string }).error).toBe('Only you can stop an architecture rule — in the CodeTrellis app, Settings → Architecture rules.');
    expect((await h.client.raw('GET', `/api/rules?project=${root}`)).status).toBe(200);
  });
});
