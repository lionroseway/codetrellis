/**
 * Phase 32 B9.3b — said on approval, and decided from the phone (JOURNEYS G3).
 *
 * JIRA-142 and JIRA-150 both plan to change validators.ts. Sam approves
 * JIRA-150: the approval's answer says the planned overlap it is in, and the
 * inbox says it once ("Approving JIRA-150 puts it in a planned overlap")
 * until he marks it seen. Approving a plan that meets nobody says nothing.
 * On his phone, play-forward is the same answer as the desktop's, and he
 * leaves the overlap from there: the decision is his, from the phone.
 * Approving a plan whose only overlap was left says nothing; another plan
 * joining it makes a new one, and approving that on the phone says it there.
 */

import { test, expect } from '@playwright/test';
import { setupHarness, pairPhone, type Harness, type Phone, type ScriptedAgent } from '../harness';
import type { PlayForward } from '../../src/shared/types/play-forward';

const VALIDATORS = 'packages/shared/src/validators.ts';

test.describe.serial('Planned overlaps on approval, and on the phone', () => {
  test.setTimeout(180_000);
  let h: Harness;
  let root: string;
  let agent: ScriptedAgent;
  let phone: Phone;
  const plans: Record<string, string> = {};

  const q = () => `?project=${encodeURIComponent(root)}`;
  const forward = async () => (await (await h.client.raw('GET', `/api/play-forward${q()}`)).json()) as PlayForward;
  const notices = async () => ((await (await h.client.raw('GET', `/api/play-forward/notices?project=${encodeURIComponent(root)}`)).json()) as { notices: Array<{ id: number; title: string; overlaps: string[] }> }).notices;
  const approve = async (uid: string) => (await (await h.client.raw('PUT', `/api/plans/${uid}`, { status: 'approved' })).json()) as { ok: boolean; plannedOverlaps?: string[] };

  test.beforeAll(async () => {
    h = await setupHarness('play-forward-approval');
    root = h.fixture.projectPath;
    await h.client.scanProject(root);
    agent = await h.spawnAgent({ agentType: 'claude-code' });
    const plan = async (name: string, key: string | null, file: string | null) => {
      const uid = (await h.client.createPlan({ title: name, projectPath: root })).uid;
      if (key) await agent.callTool('set_plan_external_ref', { plan_uid: uid, url: `https://example.atlassian.net/browse/${key}`, key });
      await h.client.raw('POST', `/api/plans/${uid}/items`, { kind: 'action', title: `${name} task`, ...(file ? { fileSpecs: [{ path: file, action: 'modify' }] } : {}) });
      return uid;
    };
    plans.vat = await plan('VAT rounding', 'JIRA-142', VALIDATORS);
    plans.currency = await plan('Currency', 'JIRA-150', VALIDATORS);
    plans.docs = await plan('Docs tidy', null, 'README.md');
    plans.refunds = await plan('Refunds', 'JIRA-160', null);
    phone = await pairPhone(h.client, { alias: 'Sam\'s phone' });
  });
  test.afterAll(async () => { await phone?.close?.(); await h?.teardown(); });

  test('approving JIRA-150 says the planned overlap it is in, and the inbox says it once', async () => {
    const r = await approve(plans.currency);
    expect(r.plannedOverlaps).toHaveLength(1);
    expect(r.plannedOverlaps![0]).toMatch(/^◇ planned overlap: .*JIRA-150.* plan to change packages\/shared\/src\/validators\.ts$/);
    const n = await notices();
    expect(n).toHaveLength(1);
    expect(n[0].title).toBe('Approving JIRA-150 puts it in a planned overlap');
    expect(n[0].overlaps).toEqual(r.plannedOverlaps);
    // Approving it again changes nothing and says nothing more.
    expect((await approve(plans.currency)).plannedOverlaps).toBeUndefined();
    expect(await notices()).toHaveLength(1);
  });

  test('a plan that meets nobody says nothing; seen, the notice leaves the inbox', async () => {
    expect((await approve(plans.docs)).plannedOverlaps).toBeUndefined();
    const [n] = await notices();
    expect((await h.client.raw('POST', `/api/play-forward/notices/${n.id}/seen?project=${encodeURIComponent(root)}`, {})).status).toBe(200);
    expect(await notices()).toEqual([]);
    expect((await h.client.raw('POST', `/api/play-forward/notices/${n.id}/seen?project=${encodeURIComponent(root)}`, {})).status).toBe(404);
  });

  test('the phone\'s play-forward is the desktop\'s, and Sam leaves the overlap from it, as himself', async () => {
    const onPhone = (await phone.rpc('playForward.summary', { projectPath: root })) as PlayForward & { notices: unknown[] };
    const { notices: phoneNotices, ...rest } = onPhone;
    expect(rest).toEqual(await forward());
    expect(phoneNotices).toEqual([]);
    const overlap = rest.overlaps.find((o) => o.subject === VALIDATORS)!;
    const done = (await phone.rpc('playForward.decide', { projectPath: root, overlapId: overlap.id, action: 'leave' })) as { playForward: PlayForward };
    const after = done.playForward.overlaps.find((o) => o.id === overlap.id)!;
    expect(after.left).toBe(true);
    // The phone is the person, not "unverified": its decisions are made on the paired device.
    expect(after.decisions.at(-1)).toMatchObject({ action: 'leave', byType: 'human' });
    expect(await phone.rpcError('playForward.decide', { projectPath: root, overlapId: overlap.id, action: 'shrug' })).toMatch(/resequence, tell or leave/);
    expect(await phone.rpcError('playForward.summary', { projectPath: '/etc' })).toMatch(/not|trusted|opened/i);
  });

  test('approving on the phone says it there too; an overlap left as it is is not said again', async () => {
    // JIRA-142's only overlap was left as it is: approving it says nothing.
    expect(((await phone.rpc('plan.update', { uid: plans.vat, status: 'approved' })) as { plannedOverlaps?: string[] }).plannedOverlaps).toBeUndefined();
    // JIRA-160 now plans to change validators.ts too: three plans meet, a new planned overlap.
    await h.client.raw('POST', `/api/plans/${plans.refunds}/items`, { kind: 'action', title: 'Validate refunds', fileSpecs: [{ path: VALIDATORS, action: 'modify' }] });
    const r = (await phone.rpc('plan.update', { uid: plans.refunds, status: 'approved' })) as { ok: boolean; plannedOverlaps?: string[] };
    expect(r.plannedOverlaps).toHaveLength(1);
    expect(r.plannedOverlaps![0]).toMatch(/JIRA-160/);
    expect((await notices())[0].title).toBe('Approving JIRA-160 puts it in a planned overlap');
  });
});
