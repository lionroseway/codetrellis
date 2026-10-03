/**
 * H1 "done when" (Phase 32 B6.7, JOURNEYS H1): the lead's morning view.
 *
 * Two agents in two plans on two real worktrees of the sample app. Billing
 * v2 changes `validateCreateUser`'s signature on billing-v2; Exports, called
 * by its ticket key JIRA-150, imports it on exports. Exports' task waits on
 * Billing's. The window's stack, an MCP client's `get_stack` and a paired
 * phone's `stack.summary` all say the same: the plans by ticket key, who is
 * on what and where, "⚠ overlaps JIRA-150" in words with the open signal
 * behind it, and the wait across plans. Asked about the moment before
 * Exports existed, the stack says so; and once Billing's task is done the
 * wait is gone everywhere at once.
 */

import { test, expect } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { setupHarness, pairPhone, createMcpClient, type Harness, type ScriptedMcp } from '../harness';
import type { Stack, StackPlan, StackTask } from '../../src/shared/types/stack';

const VALIDATORS = 'packages/shared/src/validators.ts';
const USER_LIST = 'packages/web/src/UserList.tsx';
const ENV = { ...process.env, GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@x', GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@x' };

test.describe.serial('H1: the lead\'s morning view', () => {
  test.setTimeout(180_000);

  let h: Harness;
  let root: string;
  let billing: string;
  let exportsPlan: string;
  let migrate: string;
  let deploy: string;
  let beforeExports = 0;
  const trees: string[] = [];
  const agents: ScriptedMcp[] = [];

  const q = () => `project=${encodeURIComponent(root)}`;
  const windowStack = async () => (await (await h.client.raw('GET', `/api/stack?${q()}`)).json()) as Stack;
  const planIn = (s: Stack, uid: string): StackPlan => s.plans.find((p) => p.uid === uid)!;
  const taskIn = (s: Stack, uid: string): StackTask => s.plans.flatMap((p) => p.tasks).find((t) => t.uid === uid)!;
  const post = async (url: string, body: unknown) => ((await (await h.client.raw('POST', url, body)).json()) as { uid: string }).uid;

  test.beforeAll(async () => {
    h = await setupHarness('awareness-h1', { env: { CODETRELLIS_WORKSTREAM_DEBOUNCE_MS: '150' } });
    root = h.fixture.projectPath;
    const edit = (folder: string, rel: string, from: string, to: string) => {
      const f = path.join(folder, rel);
      const before = fs.readFileSync(f, 'utf-8');
      expect(before, `${rel} has what the edit replaces`).toContain(from);
      fs.writeFileSync(f, before.replace(from, to));
    };
    for (const branch of ['billing-v2', 'exports']) {
      const dir = `${root}-${branch}`;
      execFileSync('git', ['-C', root, 'worktree', 'add', '-q', dir, '-b', branch], { env: ENV });
      trees.push(dir);
    }
    const [billingTree, exportsTree] = trees;
    edit(billingTree, VALIDATORS, 'validateCreateUser(payload: CreateUserPayload)', 'validateCreateUser(payload: CreateUserPayload, strict: boolean)');
    execFileSync('git', ['-C', billingTree, 'commit', '-q', '-am', 'billing: strict validation'], { env: ENV });
    edit(exportsTree, USER_LIST, "import { validateCreateUser } from '@sample/shared';", "import { validateCreateUser } from '@sample/shared';\n// exports: the export form");
    execFileSync('git', ['-C', exportsTree, 'commit', '-q', '-am', 'exports: export form'], { env: ENV });
    await h.client.scanProject(root);

    // Billing first, alone.
    billing = (await h.client.createPlan({ title: 'Billing v2', projectPath: root })).uid;
    migrate = await post(`/api/plans/${billing}/items`, { kind: 'action', title: 'Strict validation', fileSpecs: [{ path: VALIDATORS, action: 'modify' }] });
    expect((await h.client.raw('PUT', `/api/items/${migrate}/workstream`, { workstream: 'billing-v2' })).ok).toBe(true);
    await new Promise((r) => setTimeout(r, 30));
    beforeExports = Date.now();
    await new Promise((r) => setTimeout(r, 30));

    // Then Exports, by its ticket, waiting on Billing's task.
    exportsPlan = (await h.client.createPlan({ title: 'Exports', projectPath: root })).uid;
    deploy = await post(`/api/plans/${exportsPlan}/items`, { kind: 'action', title: 'Export form', dependencies: [migrate] });
    expect((await h.client.raw('PUT', `/api/items/${deploy}/workstream`, { workstream: 'exports' })).ok).toBe(true);

    // Each agent works in its own worktree, which is where its task is worked.
    const inTree = async (clientName: string, tree: string) => {
      const mcp = createMcpClient({ mcpPort: h.backend.mcpPort, capabilityToken: h.backend.capabilityToken, clientName, roots: [tree] });
      await mcp.connect();
      agents.push(mcp);
      return mcp;
    };
    const codex = await inTree('codex', billingTree);
    const claude = await inTree('claude-code', exportsTree);
    await codex.callTool('set_plan_external_ref', { plan_uid: exportsPlan, url: 'https://example.atlassian.net/browse/JIRA-150', key: 'JIRA-150' });
    expect((await codex.callTool('claim_item', { uid: migrate })).isError).toBeFalsy();
    // Claiming a task that waits says what it waits on, and still claims it.
    const waiting = await claude.callTool('claim_item', { uid: deploy });
    expect(waiting.isError).toBeFalsy();
    expect(waiting.answer).toContain('Strict validation');

    // The window shows the strip once, which starts the watchers; the contract opens between the two lines of work.
    expect((await h.client.raw('GET', `/api/workstreams?${q()}`)).ok).toBe(true);
    await expect.poll(async () => {
      const body = (await (await h.client.raw('GET', `/api/awareness?fresh=1&${q()}`)).json()) as { signals: Array<{ kind: string }> };
      return body.signals.some((s) => s.kind === 'contract');
    }, { timeout: 15_000, intervals: [300] }).toBe(true);
  });

  test.afterAll(async () => {
    for (const a of agents) await a.disconnect().catch(() => {});
    for (const w of trees) {
      try { execFileSync('git', ['-C', root, 'worktree', 'remove', '--force', w]); } catch { /* */ }
    }
    await h?.teardown();
  });

  test('the window: plans by ticket key, who is on what and where, the overlap in words, the wait across plans', async () => {
    const stack = await windowStack();
    expect(stack.plans.map((p) => p.label).sort()).toEqual(['Billing v2', 'JIRA-150']);

    expect(taskIn(stack, migrate)).toMatchObject({ assignee: 'codex', workstream: 'billing-v2' });
    expect(taskIn(stack, deploy)).toMatchObject({ assignee: 'claude-code', workstream: 'exports' });

    const fromBilling = planIn(stack, billing).overlaps.find((o) => o.withPlanUid === exportsPlan)!;
    expect(fromBilling.words).toBe('⚠ overlaps JIRA-150');
    expect(fromBilling.actual.map((s) => s.kind)).toContain('contract');
    expect(fromBilling.detail).toMatch(/Open now: /);
    expect(planIn(stack, exportsPlan).overlaps.find((o) => o.withPlanUid === billing)!.words).toBe('⚠ overlaps Billing v2');

    expect(taskIn(stack, deploy).dependencies).toEqual([
      expect.objectContaining({ uid: migrate, met: false, problem: 'unfinished', planUid: billing, planTitle: 'Billing v2' }),
    ]);
    expect(taskIn(stack, deploy).waits).toBe('"Export form" waits on "Strict validation" in plan "Billing v2".');
  });

  test('an MCP client and a paired phone see the same stack', async () => {
    const lead = await h.spawnAgent({ agentType: 'cursor' });
    const viaMcp = JSON.parse((await lead.callTool('get_stack', { project_path: root })).answer) as Stack;
    const phone = await pairPhone(h.client, { alias: 'H1 phone' });
    try {
      const viaPhone = await phone.rpc('stack.summary', { projectPath: root }) as Stack;
      const live = await windowStack();
      expect(viaMcp).toEqual(live);
      expect(viaPhone).toEqual(live);
    } finally {
      await phone.close();
    }
  });

  test('before Exports existed, the stack then had Billing alone, with nobody on its task yet', async () => {
    const lead = await h.spawnAgent({ agentType: 'cursor' });
    const r = await lead.callTool('get_state_at', { at: beforeExports, project_path: root });
    expect(r.isError, r.text).toBeFalsy();
    const then = (JSON.parse(r.text) as { stack: Stack }).stack;
    expect(then.plans.map((p) => p.label)).toEqual(['Billing v2']);
    expect(taskIn(then, migrate)).toMatchObject({ assignee: null, workstream: 'billing-v2' });
  });

  test('once Billing\'s task is done, the wait is gone for the window, the agent and the phone alike', async () => {
    expect((await h.client.raw('PUT', `/api/items/${migrate}`, { status: 'done' })).ok).toBe(true);
    const live = await windowStack();
    expect(taskIn(live, deploy).waits).toBeNull();
    expect(taskIn(live, deploy).dependencies).toEqual([expect.objectContaining({ uid: migrate, met: true })]);

    const lead = await h.spawnAgent({ agentType: 'cursor' });
    expect(JSON.parse((await lead.callTool('get_stack', { project_path: root })).answer)).toEqual(live);
    const phone = await pairPhone(h.client, { alias: 'H1 phone, later' });
    try {
      expect(await phone.rpc('stack.summary', { projectPath: root })).toEqual(live);
    } finally {
      await phone.close();
    }
  });
});
