/**
 * Overlap bands in the stack (Phase 32 B6.3).
 *
 * Billing v2 is worked on billing-v2 and changes `validateCreateUser`'s
 * signature; Exports (JIRA-150) is worked on checkout-fix and imports it.
 * Both are committed on their branches, so a contract signal opens between
 * the two worktrees: an actual overlap. Both plans also name
 * `packages/shared/src/validators.ts` in their tasks: a declared one. A third
 * plan touches nothing of theirs and overlaps nobody.
 */

import { test, expect } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { setupHarness, type Harness } from '../harness';
import type { ScriptedAgent } from '../harness/scripted-agent';
import type { Stack, StackPlan } from '../../src/shared/types/stack';

const VALIDATORS = 'packages/shared/src/validators.ts';
const USER_LIST = 'packages/web/src/UserList.tsx';
const ENV = { ...process.env, GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@x', GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@x' };

test.describe.serial('Overlap bands in the stack', () => {
  test.setTimeout(120_000);

  let h: Harness;
  let agent: ScriptedAgent;
  let root: string;
  let billing: string;
  let checkout: string;
  let billingPlan: string;
  let exportsPlan: string;
  let otherPlan: string;

  const stack = async () => (await (await h.client.raw('GET', `/api/stack?project=${encodeURIComponent(root)}`)).json()) as Stack;
  const row = (s: Stack, uid: string) => s.plans.find((p) => p.uid === uid) as StackPlan;
  const post = async (p: string, body: unknown) => (await h.client.raw('POST', p, body)).json() as Promise<{ uid: string }>;

  test.beforeAll(async () => {
    h = await setupHarness('stack-overlaps', { env: { CODETRELLIS_WORKSTREAM_DEBOUNCE_MS: '150' } });
    root = h.fixture.projectPath;
    billing = `${root}-billing`;
    checkout = `${root}-checkout`;
    for (const [dir, branch] of [[billing, 'billing-v2'], [checkout, 'checkout-fix']]) {
      execFileSync('git', ['-C', root, 'worktree', 'add', '-q', dir, '-b', branch], { env: ENV });
    }
    const edit = (folder: string, rel: string, from: string, to: string) => {
      const f = path.join(folder, rel);
      fs.writeFileSync(f, fs.readFileSync(f, 'utf-8').replace(from, to));
    };
    edit(checkout, USER_LIST, "import { validateCreateUser } from '@sample/shared';", "import { validateCreateUser } from '@sample/shared';\n// checkout-fix: the signup form");
    execFileSync('git', ['-C', checkout, 'commit', '-q', '-am', 'checkout: signup form'], { env: ENV });
    edit(billing, VALIDATORS, 'validateCreateUser(payload: CreateUserPayload)', 'validateCreateUser(payload: CreateUserPayload, strict: boolean)');
    execFileSync('git', ['-C', billing, 'commit', '-q', '-am', 'billing: strict validation'], { env: ENV });
    await h.client.scanProject(root);
    agent = await h.spawnAgent({ agentType: 'codex' });

    billingPlan = (await h.client.createPlan({ title: 'Billing v2', projectPath: root })).uid;
    exportsPlan = (await h.client.createPlan({ title: 'Exports', projectPath: root })).uid;
    otherPlan = (await h.client.createPlan({ title: 'Docs refresh', projectPath: root })).uid;
    await agent.callTool('set_plan_external_ref', { plan_uid: exportsPlan, url: 'https://example.atlassian.net/browse/JIRA-150', key: 'JIRA-150' });

    const task = async (plan: string, title: string, branch: string | null, file: string) => {
      const uid = (await post(`/api/plans/${plan}/items`, { kind: 'action', title, fileSpecs: [{ path: file, action: 'modify' }] })).uid;
      if (branch) expect((await h.client.raw('PUT', `/api/items/${uid}/workstream`, { workstream: branch })).ok).toBe(true);
    };
    await task(billingPlan, 'Strict validation', 'billing-v2', VALIDATORS);
    await task(exportsPlan, 'Signup form', 'checkout-fix', VALIDATORS);
    await task(otherPlan, 'Rewrite the README', null, 'README.md');

    // Wait for the contract signal between the two worktrees.
    expect((await h.client.raw('GET', `/api/workstreams?project=${encodeURIComponent(root)}`)).ok).toBe(true);
    await expect.poll(async () => {
      const body = (await (await h.client.raw('GET', `/api/awareness?project=${encodeURIComponent(root)}`)).json()) as { signals: Array<{ kind: string }> };
      return body.signals.some((s) => s.kind === 'contract');
    }, { timeout: 15_000, intervals: [300] }).toBe(true);
  });

  test.afterAll(async () => {
    for (const w of [billing, checkout]) {
      try { execFileSync('git', ['-C', root, 'worktree', 'remove', '--force', w]); } catch { /* */ }
    }
    await h?.teardown();
  });

  test('two plans that touch the same code overlap, declared and actual, in words from each side', async () => {
    const s = await stack();
    const fromBilling = row(s, billingPlan).overlaps;
    expect(fromBilling).toHaveLength(1);
    expect(fromBilling[0]).toMatchObject({
      withPlanUid: exportsPlan,
      withLabel: 'JIRA-150',
      words: '⚠ overlaps JIRA-150',
      declared: { files: [VALIDATORS], symbols: [] },
      high: true,
    });
    expect(fromBilling[0].actual.map((a) => a.kind)).toContain('contract');
    expect(fromBilling[0].detail).toContain(`Both plan to change ${VALIDATORS}.`);
    expect(fromBilling[0].detail).toContain('Open now:');

    expect(row(s, exportsPlan).overlaps[0]).toMatchObject({ withPlanUid: billingPlan, words: '⚠ overlaps Billing v2' });
    expect(row(s, otherPlan).overlaps).toEqual([]);
  });

  test('once the signal is dismissed, the overlap is what the plans declare', async () => {
    const body = (await (await h.client.raw('GET', `/api/awareness?project=${encodeURIComponent(root)}`)).json()) as { signals: Array<{ id: string; kind: string }> };
    for (const sig of body.signals.filter((x) => x.kind === 'contract')) {
      expect((await h.client.raw('POST', `/api/awareness/${encodeURIComponent(sig.id)}/state?project=${encodeURIComponent(root)}`, { state: 'dismissed' })).ok).toBe(true);
    }
    const [overlap] = row(await stack(), billingPlan).overlaps;
    expect(overlap.actual).toEqual([]);
    expect(overlap.high).toBe(false);
    expect(overlap.detail).toBe(`Both plan to change ${VALIDATORS}.`);
  });

  test('an agent\'s get_stack carries the same overlaps', async () => {
    const viaMcp = JSON.parse((await agent.callTool('get_stack', { project_path: root })).answer) as Stack;
    expect(row(viaMcp, billingPlan).overlaps).toEqual(row(await stack(), billingPlan).overlaps);
  });
});
