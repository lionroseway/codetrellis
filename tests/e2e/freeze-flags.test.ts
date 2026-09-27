/**
 * Freeze changes are recorded, and an agent's is flagged until a person has
 * seen it — on the desktop and on the phone (owner's decision, Phase 32 §0.4k).
 *
 * Agents may freeze, lift and exempt: the freeze is advisory, and blocking
 * them was not the decision. What was missing is that nothing told anyone an
 * agent had let itself through. Same stance as budgets (0.4g): tag, don't
 * block.
 */

import { test, expect } from '@playwright/test';
import { setupHarness, openEventStream, pairPhone, type Harness, type ScriptedAgent, type EventStream, type Phone } from '../harness';

interface Change { id: number; actor: string; actorType: string; channel: string; flagged: boolean; before: unknown; after: { active: boolean; allowedPlanUids: string[] }; acknowledgedBy: string | null }

test.describe.serial('Freeze changes are flagged', () => {
  test.setTimeout(90_000);

  let h: Harness;
  let agent: ScriptedAgent;
  let events: EventStream;
  let phone: Phone;
  let root: string;
  let planUid: string;

  const req = async (method: string, url: string, body?: unknown) => {
    const res = await h.client.raw(method, url, body);
    expect(res.ok, `${method} ${url}: ${res.status} ${await res.clone().text()}`).toBe(true);
    return res.json();
  };
  const status = async () => req('GET', `/api/freeze?project=${encodeURIComponent(root)}`);
  const changes = async () => (await req('GET', `/api/freeze/changes?project=${encodeURIComponent(root)}`)) as Change[];

  test.beforeAll(async () => {
    h = await setupHarness('freeze-flags');
    root = h.fixture.projectPath;
    await h.client.scanProject(root);
    agent = await h.spawnAgent({ agentType: 'claude-desktop' });
    events = await openEventStream(h.backend);
    planUid = (await h.client.createPlan({ title: 'Hotfix', projectPath: root })).uid;
  });

  test.afterAll(async () => {
    await phone?.close();
    await events?.close();
    await h?.teardown();
  });

  test('a person freezes: recorded with how it arrived, not flagged', async () => {
    await req('PUT', '/api/freeze', { projectPath: root, active: true, reason: 'Release 2.0', until: '2030-01-01T00:00:00.000Z' });
    expect((await status()).flaggedChanges).toEqual([]);
    const [first] = await changes();
    expect(first).toMatchObject({ actorType: 'unverified', channel: 'local-api', flagged: false, before: null, after: { active: true } });
  });

  test('an agent exempts its own plan: allowed, in its name, flagged; an unknown plan is refused', async () => {
    const res = await agent.callTool('exempt_plan_from_freeze', { project_path: root, plan_uid: planUid });
    expect(res.isError, res.text).not.toBe(true);
    expect(res.text).toContain('flagged for a person to review');
    await events.waitFor('freeze-changed', (p) => p.status?.flaggedChanges?.length === 1);
    const flagged = (await status()).flaggedChanges as Change[];
    expect(flagged).toHaveLength(1);
    expect(flagged[0]).toMatchObject({ actor: 'claude-desktop', actorType: 'mcp', channel: 'mcp', after: { allowedPlanUids: [planUid] } });

    const unknown = await agent.callTool('exempt_plan_from_freeze', { project_path: root, plan_uid: 'no-such-plan' });
    expect(unknown.isError).toBe(true);
    expect(unknown.text).toMatch(/Plan not found/);
  });

  test('an agent lifts the freeze: flagged, and still shown although nothing is frozen', async () => {
    const res = await agent.callTool('set_freeze', { project_path: root, active: false });
    expect(res.isError, res.text).not.toBe(true);
    const now = await status();
    expect(now.active).toBe(false);
    expect((now.flaggedChanges as Change[]).map((c) => c.after.active)).toEqual([true, false]);

    // Checking gives agents the same view.
    const seen = JSON.parse((await agent.callTool('get_freeze_status', { project_path: root })).text);
    expect(seen.flaggedChanges).toHaveLength(2);

    // Setting what is already set changes nothing, so records nothing.
    await agent.callTool('set_freeze', { project_path: root, active: false });
    expect(await changes()).toHaveLength(3);
  });

  test('on the phone: the same changes in words; marking one seen there is the person\'s', async () => {
    phone = await pairPhone(h.client, { alias: 'Freeze phone' });
    const onPhone = await phone.rpc('freeze.get', { planUid });
    expect(onPhone).toMatchObject({ planUid, active: false, planExempt: false }); // lifting cleared the exemptions
    expect(onPhone.flaggedChanges.map((c: { by: string; words: string }) => [c.by, c.words])).toEqual([
      ['claude-desktop', 'exempted 1 plan'],
      ['claude-desktop', 'lifted the freeze'],
    ]);
    expect(await phone.rpcError('freeze.get', { planUid: 'no-such-plan' })).toMatch(/Plan not found/);

    const after = await phone.rpc('freeze.acknowledge', { planUid, changeId: onPhone.flaggedChanges[0].id });
    expect(after.flaggedChanges.map((c: { words: string }) => c.words)).toEqual(['lifted the freeze']);
    await events.waitFor('freeze-changed', (p) => p.acknowledged === onPhone.flaggedChanges[0].id);
    const audit = await req('GET', `/api/peers/audit?fingerprint=${encodeURIComponent(phone.fingerprint)}`);
    expect((Array.isArray(audit) ? audit : audit.entries).some((e: { method: string; kind: string }) => e.method === 'freeze.acknowledge' && e.kind === 'decision')).toBe(true);
    expect(await phone.rpcError('freeze.acknowledge', { planUid, changeId: 'x' })).toMatch(/changeId must be a number/);
  });

  test('on the desktop: marked seen, with who; unknown or outside a project refused', async () => {
    const [last] = (await status()).flaggedChanges as Change[];
    const seen = await req('POST', `/api/freeze/changes/${last.id}/acknowledge`, { projectPath: root });
    expect(seen).toMatchObject({ id: last.id, flagged: false });
    expect(seen.acknowledgedBy).toBeTruthy();
    expect((await status()).flaggedChanges).toEqual([]);
    expect((await changes()).map((c) => c.flagged)).toEqual([false, false, false]);

    expect((await h.client.raw('POST', '/api/freeze/changes/999999/acknowledge', { projectPath: root })).status).toBe(404);
    expect((await h.client.raw('POST', `/api/freeze/changes/${last.id}/acknowledge`, { projectPath: '/etc' })).status).toBe(403);
    expect((await h.client.raw('GET', '/api/freeze/changes?project=%2Fetc')).status).toBe(403);
  });
});
