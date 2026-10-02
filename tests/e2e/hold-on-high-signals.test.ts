/**
 * Sign-off waits for an open high overlap, when the project asks (Phase 32
 * A5.3, awareness spec §9.2).
 *
 * The project turns on `sensors.awareness.holdSignOffOnHighSignals`. billing-v2
 * changes `validateCreateUser`, which checkout-fix's work imports: a high
 * contract overlap. The plan's item is billing-v2's, with a `code` criterion.
 * Checking it fails and names the overlap in the desktop's words, the way a
 * failing test would. Once the person marks the overlap intended, the same
 * check no longer holds it. Awareness never blocks a tool call: only the
 * criterion's check changes.
 */

import { test, expect } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { setupHarness, type Harness, type ScriptedAgent } from '../harness';

const VALIDATORS = 'packages/shared/src/validators.ts';
const USER_LIST = 'packages/web/src/UserList.tsx';
const ENV = { ...process.env, GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@x', GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@x' };
const HELD = /^A high overlap with other work is still open \(Changed signature\): billing-v2 changed validateCreateUser's signature/;

interface Check { ok: boolean; findings: Array<{ status: string; message: string }> }

test.describe.serial('Sign-off waits for an open high overlap', () => {
  test.setTimeout(120_000);

  let h: Harness;
  let root: string;
  let billing: string;
  let checkout: string;
  let agent: ScriptedAgent;
  let criterionUid: string;
  let signalId: string;

  const q = () => `project=${encodeURIComponent(root)}`;
  const check = async (): Promise<Check> => {
    const r = await agent.callTool('check_criterion', { criterion_uid: criterionUid });
    expect(r.isError, r.text).toBeFalsy();
    return JSON.parse(r.text) as Check;
  };

  test.beforeAll(async () => {
    h = await setupHarness('hold-on-high-signals', { env: { CODETRELLIS_WORKSTREAM_DEBOUNCE_MS: '150' } });
    root = h.fixture.projectPath;
    // The person's choice, in the project's own config file.
    fs.mkdirSync(path.join(root, '.codetrellis'), { recursive: true });
    fs.writeFileSync(path.join(root, '.codetrellis', 'config.json'), JSON.stringify({ sensors: { awareness: { holdSignOffOnHighSignals: true } } }));

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
    await h.client.scanProject(root);

    const plan = await h.client.createPlan({ title: 'Billing v2', projectPath: root });
    const item = ((await (await h.client.raw('POST', `/api/plans/${plan.uid}/items`, { kind: 'action', title: 'Strict validation' })).json()) as { uid: string }).uid;
    expect((await h.client.raw('PUT', `/api/items/${item}/workstream`, { workstream: 'billing-v2' })).ok).toBe(true);
    criterionUid = ((await (await h.client.raw('POST', `/api/items/${item}/criteria`, { text: 'The change is in', kind: 'code' })).json()) as { uid: string }).uid;
    agent = await h.spawnAgent({ agentType: 'claude-code' });

    expect((await h.client.raw('GET', `/api/workstreams?${q()}`)).ok).toBe(true);
    edit(billing, VALIDATORS, 'validateCreateUser(payload: CreateUserPayload)', 'validateCreateUser(payload: CreateUserPayload, strict: boolean)');
    await expect.poll(async () => {
      const body = (await (await h.client.raw('GET', `/api/awareness?${q()}`)).json()) as { signals: Array<{ id: string; kind: string }> };
      return body.signals.find((s) => s.kind === 'contract')?.id ?? null;
    }, { timeout: 15_000, intervals: [300] }).not.toBeNull();
    const body = (await (await h.client.raw('GET', `/api/awareness?${q()}`)).json()) as { signals: Array<{ id: string; kind: string }> };
    signalId = body.signals.find((s) => s.kind === 'contract')!.id;
  });

  test.afterAll(async () => {
    for (const w of [billing, checkout]) {
      try { execFileSync('git', ['-C', root, 'worktree', 'remove', '--force', w]); } catch { /* */ }
    }
    await h?.teardown();
  });

  test('while the overlap is open, the code criterion fails and names it', async () => {
    const result = await check();
    expect(result.ok).toBe(false);
    const held = result.findings.find((f) => HELD.test(f.message));
    expect(held?.status).toBe('fail');
    expect(held?.message).toContain('checkout-fix imports it');
  });

  test('marked intended by the person, the check no longer holds it', async () => {
    expect((await h.client.raw('POST', `/api/awareness/${signalId}/state?${q()}`, { state: 'intended' })).ok).toBe(true);
    const result = await check();
    expect(result.findings.some((f) => HELD.test(f.message))).toBe(false);
  });
});
