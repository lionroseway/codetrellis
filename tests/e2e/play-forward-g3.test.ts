/**
 * Phase 32 B9.4 — the G3 done-when, end to end (JOURNEYS G3).
 *
 * Two plans, JIRA-142 (VAT rounding) and JIRA-150 (a currency field), both
 * plan to change the same file (the sample app's validators.ts stands in for
 * G3's invoice.ts), and an agent holds each plan's task. Both are approved:
 * each approval says the planned overlap it is in. Sam plays forward and the
 * window, an MCP client and his phone give one answer. He re-sequences from
 * the window, JIRA-142 first: JIRA-150's task now waits on JIRA-142's, in the
 * stack and in the answer, the same everywhere. From the phone he tells both
 * agents: each is told once, on its next step. The decisions read the same on
 * all three, with who made each.
 */

import { test, expect } from '@playwright/test';
import { setupHarness, pairPhone, type Harness, type Phone, type ScriptedAgent } from '../harness';
import type { PlayForward } from '../../src/shared/types/play-forward';

const FILE = 'packages/shared/src/validators.ts';

interface StackTask { uid: string; waits: string | null }
interface Stack { plans: Array<{ uid: string; tasks: StackTask[] }> }

test.describe.serial('G3: two plans that will meet, seen and settled before either starts', () => {
  test.setTimeout(180_000);
  let h: Harness;
  let root: string;
  let vatAgent: ScriptedAgent;
  let currencyAgent: ScriptedAgent;
  let phone: Phone;
  let vat: string;
  let currency: string;
  let vatTask: string;
  let currencyTask: string;

  const q = () => `?project=${encodeURIComponent(root)}`;
  const inWindow = async () => (await (await h.client.raw('GET', `/api/play-forward?project=${encodeURIComponent(root)}`)).json()) as PlayForward;
  const viaMcp = async () => JSON.parse((await vatAgent.callTool('get_play_forward', { project_path: root })).answer) as PlayForward;
  const onPhone = async () => {
    const { notices: _notices, ...rest } = (await phone.rpc('playForward.summary', { projectPath: root })) as PlayForward & { notices: unknown[] };
    return rest as PlayForward;
  };
  /** The window, an MCP client and the phone, asked at once: one answer. */
  const agreed = async () => {
    const [w, m, p] = await Promise.all([inWindow(), viaMcp(), onPhone()]);
    expect(m).toEqual(w);
    expect(p).toEqual(w);
    return w;
  };
  const stackEverywhere = async () => {
    const w = (await (await h.client.raw('GET', `/api/stack?project=${encodeURIComponent(root)}`)).json()) as Stack;
    expect(JSON.parse((await vatAgent.callTool('get_stack', { project_path: root })).answer)).toEqual(w);
    expect(await phone.rpc('stack.summary', { projectPath: root })).toEqual(w);
    return w;
  };
  const taskIn = (s: Stack, uid: string) => s.plans.flatMap((p) => p.tasks).find((t) => t.uid === uid)!;

  test.beforeAll(async () => {
    h = await setupHarness('play-forward-g3');
    root = h.fixture.projectPath;
    await h.client.scanProject(root);
    vatAgent = await h.spawnAgent({ agentType: 'claude-code' });
    currencyAgent = await h.spawnAgent({ agentType: 'codex' });
    const plan = async (title: string, key: string, task: string) => {
      const uid = (await h.client.createPlan({ title, projectPath: root })).uid;
      await vatAgent.callTool('set_plan_external_ref', { plan_uid: uid, url: `https://example.atlassian.net/browse/${key}`, key });
      const item = ((await (await h.client.raw('POST', `/api/plans/${uid}/items`, { kind: 'action', title: task, fileSpecs: [{ path: FILE, action: 'modify' }] })).json()) as { uid: string }).uid;
      return [uid, item];
    };
    [vat, vatTask] = await plan('VAT rounding', 'JIRA-142', 'Round VAT per line');
    [currency, currencyTask] = await plan('Currency', 'JIRA-150', 'Add a currency field');
    expect((await vatAgent.claimItem(vatTask)).isError).toBeFalsy();
    expect((await currencyAgent.claimItem(currencyTask)).isError).toBeFalsy();
    phone = await pairPhone(h.client, { alias: 'Sam\'s phone' });
  });
  test.afterAll(async () => { await phone?.close?.(); await h?.teardown(); });

  test('both plans approved: each approval says the planned overlap it is in', async () => {
    for (const uid of [vat, currency]) {
      const r = (await (await h.client.raw('PUT', `/api/plans/${uid}`, { status: 'approved' })).json()) as { plannedOverlaps?: string[] };
      expect(r.plannedOverlaps).toEqual([expect.stringMatching(/^◇ planned overlap: JIRA-1(42|50) and JIRA-1(42|50) both plan to change packages\/shared\/src\/validators\.ts$/)]);
    }
    const notices = ((await (await h.client.raw('GET', `/api/play-forward/notices?project=${encodeURIComponent(root)}`)).json()) as { notices: Array<{ title: string }> }).notices;
    expect(notices.map((n) => n.title).sort()).toEqual(['Approving JIRA-142 puts it in a planned overlap', 'Approving JIRA-150 puts it in a planned overlap']);
  });

  test('played forward, the window, an MCP client and the phone give one answer', async () => {
    const f = await agreed();
    expect(f.words).toBe('Planned by 2 active plans · 1 file to change · 1 planned overlap');
    const [o] = f.overlaps;
    expect(o).toMatchObject({ kind: 'file', subject: FILE, file: FILE, serious: false, sequenced: false, left: false, decisions: [] });
    // The graph's dashed zone is drawn from the projection: the file both plan to change.
    expect(f.projection.modifiedFiles.map((m) => m.path)).toEqual([FILE]);
    // Nothing waits yet: the two tasks would meet at once.
    const s = await stackEverywhere();
    expect(taskIn(s, currencyTask).waits).toBeNull();
  });

  test('re-sequenced from the window, JIRA-142 first: JIRA-150\'s task waits, the same everywhere', async () => {
    const id = (await inWindow()).overlaps[0].id;
    const r = await h.client.raw('POST', `/api/play-forward/overlaps/${id}/resequence${q()}`, { first: vat });
    expect(r.status).toBe(200);

    const f = await agreed();
    expect(f.overlaps[0].sequenced).toBe(true);
    expect(f.overlaps[0].words).toMatch(/ · sequenced: JIRA-150 waits on JIRA-142$/);
    expect(f.words).toBe('Planned by 2 active plans · 1 file to change · 1 planned overlap (1 sequenced)');

    const s = await stackEverywhere();
    expect(taskIn(s, currencyTask).waits).toMatch(/^"Add a currency field" waits on "Round VAT per line" in plan /);
    expect(taskIn(s, vatTask).waits).toBeNull();
  });

  test('from the phone, both agents are told: each once, on its next step; the decisions read the same everywhere', async () => {
    const id = (await onPhone()).overlaps[0].id;
    const told = (await phone.rpc('playForward.decide', { projectPath: root, overlapId: id, action: 'tell' })) as { told: number; playForward: PlayForward };
    expect(told.told).toBe(2);

    const first = await currencyAgent.callTool('list_plans', {});
    expect(first.text).toContain('── CodeTrellis: planned overlap ──');
    expect(first.text).toContain('Your task "Add a currency field" (JIRA-150) and "Round VAT per line" in JIRA-142 both plan to touch packages/shared/src/validators.ts.');
    expect((await currencyAgent.callTool('list_plans', {})).text).not.toContain('planned overlap ──');
    expect((await vatAgent.callTool('list_plans', {})).text).toContain('Your task "Round VAT per line" (JIRA-142) and "Add a currency field" in JIRA-150');

    const f = await agreed();
    expect(told.playForward).toEqual(f);
    expect(f.overlaps[0].decisions.map((d) => [d.action, d.words, d.byType])).toEqual([
      ['resequence', 'JIRA-142 goes first; JIRA-150 waits', 'unverified'],
      ['tell', 'Told 2 agents', 'human'],
    ]);
  });
});
