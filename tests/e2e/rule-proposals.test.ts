/**
 * Phase 33 R3 — an agent proposes a change to a rule; a person decides.
 *
 * The team keeps the API's routes off the database. An agent finds the rule
 * in its way and proposes stopping it, and separately proposes a new rule
 * keeping the web app off the services. Nothing changes: the rules are as
 * they were, and no tool can change them. Sam sees each proposal with what it
 * would do against the code now. He rejects the stop and accepts the new
 * rule; accepting a loosening needs his confirmation, and is signed as him.
 */

import fs from 'node:fs';
import path from 'node:path';
import { test, expect } from '@playwright/test';
import { setupHarness, type Harness, type ScriptedAgent } from '../harness';
import type { RuleView } from '../../src/shared/types/architecture-rules';

interface Proposal {
  uid: string; ruleId: string; status: string; why: string; author: string; effect: string | null; words: string;
  now: { words: string; needsConfirm: boolean; breaches: number | null } | null;
}

test.describe.serial('Agents propose rules; a person decides', () => {
  test.setTimeout(120_000);
  let h: Harness;
  let root: string;
  let agent: ScriptedAgent;
  const q = () => `project=${encodeURIComponent(root)}`;
  const rules = async () => ((await (await h.client.raw('GET', `/api/rules?${q()}`)).json()) as { rules: RuleView[] }).rules;
  const proposals = async () => ((await (await h.client.raw('GET', `/api/rules/proposals?${q()}`)).json()) as { proposals: Proposal[] }).proposals;

  test.beforeAll(async () => {
    h = await setupHarness('rule-proposals');
    root = h.fixture.projectPath;
    await h.client.scanProject(root);
    const put = await h.client.raw('PUT', `/api/rules/routes-not-db?${q()}`, {
      from: 'services/api/app/routes/', mayNotImport: 'services/api/app/db.py', because: 'routes go through the service layer', strength: 'block',
    });
    expect(put.status, await put.clone().text()).toBe(200);
    agent = await h.spawnAgent({ agentType: 'claude-code' });
  });
  test.afterAll(async () => { await h?.teardown(); });

  test('an agent proposes; it is told what the change would do, and nothing changes', async () => {
    const stop = await agent.callTool('propose_rule', { id: 'routes-not-db', remove: true, why: 'The orders route needs the DB session directly for a transaction.', project_path: root });
    expect(stop.isError, stop.text).toBeFalsy();
    const s = JSON.parse(stop.answer) as { proposal: string; status: string; words: string; needsConfirm: boolean; next: string };
    expect(s.status).toBe('open');
    expect(s.words).toMatch(/^✗ This change removes the rule “services\/api\/app\/routes\/ may not import services\/api\/app\/db\.py” \(routes-not-db\): 2 imports it forbade become allowed\./);
    expect(s.needsConfirm).toBe(true);
    expect(s.next).toMatch(/A person decides in the app/);

    const add = await agent.callTool('propose_rule', {
      id: 'web-not-services', from: 'packages/web/', may_not_import: 'services/', because: 'the web app calls the API over HTTP',
      why: 'I almost imported the API\'s models into the web app.', project_path: root,
    });
    expect(add.isError, add.text).toBeFalsy();
    expect(JSON.parse(add.answer)).toMatchObject({ change: { effect: 'tightens' }, needsConfirm: false, breaches: 0 });

    // Nothing changed: the rules are as they were, and the suite file too.
    expect((await rules()).map((v) => [v.rule.id, v.rule.strength])).toEqual([['routes-not-db', 'block']]);
    expect(fs.readdirSync(path.join(root, '.codetrellis', 'rules'))).toEqual(['architecture.yaml']);

    // A proposal that changes nothing, or stops a rule that is not there, is refused with why.
    const same = await agent.callTool('propose_rule', { id: 'routes-not-db', from: 'services/api/app/routes/', may_not_import: 'services/api/app/db.py', strength: 'block', because: 'routes go through the service layer', why: 'x', project_path: root });
    expect(same.isError).toBe(true);
    expect(same.text).toMatch(/This changes nothing about how code is judged\. Nothing to propose\./);
    const gone = await agent.callTool('propose_rule', { id: 'nope', remove: true, why: 'x', project_path: root });
    expect(gone.isError).toBe(true);
  });

  test('no tool changes a rule: the only rule tools read, check or propose', async () => {
    const names = (await agent.mcp.listTools()).map((t) => t.name).filter((n) => /rule/.test(n));
    expect(names.sort()).toEqual(['list_rules', 'propose_rule']);
  });

  test('Sam sees each proposal with what it would do now, from whom and why', async () => {
    const list = await proposals();
    expect(list.map((p) => [p.ruleId, p.status, p.effect, p.author])).toEqual([
      ['web-not-services', 'open', 'tightens', 'claude-code'],
      ['routes-not-db', 'open', 'loosens', 'claude-code'],
    ]);
    const stop = list.find((p) => p.ruleId === 'routes-not-db')!;
    expect(stop.why).toBe('The orders route needs the DB session directly for a transaction.');
    expect(stop.now).toMatchObject({ needsConfirm: true });
    expect(stop.now!.words).toBe(stop.words);
  });

  test('he rejects the stop and accepts the new rule; accepting a loosening waits for his confirmation and is signed', async () => {
    const list = await proposals();
    const stop = list.find((p) => p.ruleId === 'routes-not-db')!;
    const add = list.find((p) => p.ruleId === 'web-not-services')!;

    // Accepting the stop without confirming is refused, and changes nothing.
    const unconfirmed = await h.client.raw('POST', `/api/rules/proposals/${stop.uid}/decide?${q()}`, { decision: 'accept' });
    expect(unconfirmed.status).toBe(409);
    expect(await unconfirmed.json()).toMatchObject({ needsConfirm: true });
    expect((await rules()).map((v) => v.rule.id)).toEqual(['routes-not-db']);

    const rejected = await h.client.raw('POST', `/api/rules/proposals/${stop.uid}/decide?${q()}`, { decision: 'reject', note: 'Use the service\'s transaction helper.' });
    expect(rejected.status, await rejected.clone().text()).toBe(200);
    expect(((await rejected.json()) as { proposal: Proposal & { decisionNote: string } }).proposal).toMatchObject({ status: 'rejected', decisionNote: 'Use the service\'s transaction helper.' });
    expect((await h.client.raw('POST', `/api/rules/proposals/${stop.uid}/decide?${q()}`, { decision: 'accept', confirm: true })).status).toBe(409);

    const accepted = await h.client.raw('POST', `/api/rules/proposals/${add.uid}/decide?${q()}`, { decision: 'accept' });
    expect(accepted.status, await accepted.clone().text()).toBe(200);
    expect((await rules()).map((v) => [v.rule.id, v.rule.strength]).sort()).toEqual([['routes-not-db', 'block'], ['web-not-services', 'warn']]);
    expect((await proposals()).map((p) => p.status).sort()).toEqual(['accepted', 'rejected']);

    // A loosening an agent proposed, accepted with confirmation, is signed as Sam.
    const lower = await agent.callTool('propose_rule', {
      id: 'routes-not-db', from: 'services/api/app/routes/', may_not_import: 'services/api/app/db.py', strength: 'warn', because: 'routes go through the service layer',
      why: 'Two routes break it today; let it warn while they are moved.', project_path: root,
    });
    expect(lower.isError, lower.text).toBeFalsy();
    const uid = (JSON.parse(lower.answer) as { proposal: string }).proposal;
    const ok = await h.client.raw('POST', `/api/rules/proposals/${uid}/decide?${q()}`, { decision: 'accept', confirm: true });
    expect(ok.status, await ok.clone().text()).toBe(200);
    const body = (await ok.json()) as { approval: { file: string; how: string }; proposal: Proposal };
    expect(body.proposal.status).toBe('accepted');
    expect(body.approval.file).toMatch(/^\.codetrellis\/rules\/approvals\/routes-not-db-[0-9a-f]{12}\.yaml$/);
    expect((await rules()).find((v) => v.rule.id === 'routes-not-db')?.rule.strength).toBe('warn');
    expect((await h.client.raw('POST', `/api/rules/proposals/nope/decide?${q()}`, { decision: 'accept' })).status).toBe(404);
  });
});

test.describe.serial('Only the person decides a proposed rule', () => {
  test.setTimeout(90_000);
  let h: Harness;

  test.beforeAll(async () => {
    h = await setupHarness('rule-proposals-grant', { env: { CODETRELLIS_ALLOW_HTTP_GRANTS: '0' } });
    await h.client.scanProject(h.fixture.projectPath);
  });
  test.afterAll(async () => { await h?.teardown(); });

  test('from plain HTTP, deciding is refused with where to do it; listing is not', async () => {
    const root = encodeURIComponent(h.fixture.projectPath);
    const decide = await h.client.raw('POST', `/api/rules/proposals/any/decide?project=${root}`, { decision: 'accept', confirm: true });
    expect(decide.status).toBe(403);
    expect(((await decide.json()) as { error: string }).error).toBe('Only you can decide a proposed rule — in the CodeTrellis app, Settings → Architecture rules.');
    expect((await h.client.raw('GET', `/api/rules/proposals?project=${root}`)).status).toBe(200);
  });
});
