/**
 * Workstreams on the phone (Phase 32 A4.3), end to end.
 *
 * Journey C2, the part after the push: Sam wants to know who is doing what.
 * Two worktrees, an agent in each. Codex in checkout-fix has claimed a task
 * and edited a file that billing-v2 also edits. The phone lists both lines
 * of work as the strip names them, with their agents, the task held, what
 * each has changed and the signal naming them. Opening one shows its changed
 * files and its recent turns in the Timeline's own words, newest first.
 *
 * A workstream is chosen by id among those found; a folder the phone makes
 * up is refused, as is asking with no project open.
 */

import { test, expect } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { setupHarness, createMcpClient, pairPhone, type Harness, type ScriptedMcp, type Phone } from '../harness';

interface PhoneWorkstream {
  id: string; name: string; branch: string | null; shape: string; main: boolean;
  agents: Array<{ agentType: string; source: string }>;
  tasks: Array<{ uid: string; title: string; status: string }>;
  changedFiles: number; signals: number; needsYou: number;
}
interface PhoneWorkstreamDetail extends PhoneWorkstream {
  files: Array<{ path: string; status: string; added?: number; removed?: number }>;
  turns: Array<{ agentType: string | null; summary: string; calls: number; startedAt: number }>;
}

const VALIDATORS = 'packages/shared/src/validators.ts';
const IN_ORDER = "errors.push('amount must be a positive number');";
const ENV = { ...process.env, GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@x', GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@x' };

test.describe.serial('Workstreams on the phone', () => {
  test.setTimeout(120_000);

  let h: Harness;
  let root: string;
  let billing: string;
  let checkout: string;
  let claude: ScriptedMcp;
  let codex: ScriptedMcp;
  let phone: Phone;
  let itemUid: string;

  const raw = (method: string, url: string, body?: unknown) => h.client.raw(method, url, body);
  const edit = (dir: string, from: string, to: string) => {
    const f = path.join(dir, VALIDATORS);
    fs.writeFileSync(f, fs.readFileSync(f, 'utf-8').replace(from, to));
  };
  const list = async () => (await phone.rpc<{ projectRoot: string; workstreams: PhoneWorkstream[] }>('workstreams.list')).workstreams;

  test.beforeAll(async () => {
    h = await setupHarness('phone-workstreams', { env: { CODETRELLIS_WORKSTREAM_DEBOUNCE_MS: '150' } });
    root = h.fixture.projectPath;
    billing = `${root}-billing`;
    checkout = `${root}-checkout`;
    for (const [dir, branch] of [[billing, 'billing-v2'], [checkout, 'checkout-fix']]) {
      execFileSync('git', ['-C', root, 'worktree', 'add', '-q', dir, '-b', branch], { env: ENV });
    }
    await h.client.scanProject(root);
    const mcp = (clientName: string, dir: string) => createMcpClient({ mcpPort: h.backend.mcpPort, capabilityToken: h.backend.capabilityToken, clientName, roots: [dir] });
    claude = mcp('claude-code', billing);
    codex = mcp('codex', checkout);
    await claude.connect();
    await codex.connect();
    const planUid = (await h.client.createPlan({ title: 'Checkout', projectPath: root })).uid;
    itemUid = ((await (await raw('POST', `/api/plans/${planUid}/items`, { kind: 'action', title: 'Validate refunds' })).json()) as { uid: string }).uid;
    phone = await pairPhone(h.client, { alias: 'Sam’s phone' });
  });

  test.afterAll(async () => {
    await phone?.close().catch(() => {});
    for (const a of [claude, codex]) await a?.disconnect().catch(() => {});
    for (const w of [billing, checkout]) {
      try { execFileSync('git', ['-C', root, 'worktree', 'remove', '--force', w]); } catch { /* */ }
    }
    await h?.teardown();
  });

  test('two lines of work, as the strip names them, with their agents, the task held, what each changed and the signal', async () => {
    expect((await codex.callTool('claim_item', { uid: itemUid })).isError).toBeFalsy();
    await codex.callTool('list_plans', {});
    edit(billing, IN_ORDER, "errors.push('amount must be above zero');");
    edit(checkout, IN_ORDER, "errors.push('amount must be a number above zero');");

    await expect.poll(async () => {
      const ws = await list();
      const c = ws.find((w) => w.branch === 'checkout-fix');
      return c ? `${c.changedFiles}:${c.signals}` : null;
    }, { timeout: 15_000, intervals: [300] }).toBe('1:1');

    const ws = await list();
    const byBranch = Object.fromEntries(ws.map((w) => [w.branch, w]));
    expect(byBranch['checkout-fix']).toMatchObject({
      name: 'checkout-fix', shape: 'worktree', main: false, changedFiles: 1, signals: 1, needsYou: 1,
      agents: [{ agentType: 'codex', source: 'mcp' }],
      tasks: [{ uid: itemUid, title: 'Validate refunds', status: 'assigned' }],
    });
    expect(byBranch['billing-v2']).toMatchObject({ name: 'billing-v2', agents: [{ agentType: 'claude-code' }], tasks: [], changedFiles: 1, signals: 1 });
  });

  test('opening one: its changed files, and its recent turns in the Timeline\'s words, newest first', async () => {
    const id = (await list()).find((w) => w.branch === 'checkout-fix')!.id;
    const { workstream } = await phone.rpc<{ workstream: PhoneWorkstreamDetail }>('workstreams.detail', { id });
    expect(workstream.files).toEqual([expect.objectContaining({ path: VALIDATORS, status: 'modified' })]);
    expect(workstream.turns.length).toBeGreaterThan(0);
    const turn = workstream.turns[0];
    expect(turn.agentType).toBe('codex');
    expect(turn.calls).toBeGreaterThan(0);
    expect(turn.summary.length).toBeGreaterThan(0);
    // The claim is in it, in words, not the tool's name alone.
    expect(workstream.turns.map((t) => t.summary).join(' | ')).toMatch(/Validate refunds|claim/i);
  });

  test('refused: a folder the phone makes up, no id', async () => {
    expect(await phone.rpcError('workstreams.detail', { id: '/etc' })).toMatch(/No such workstream/);
    expect(await phone.rpcError('workstreams.detail', {})).toMatch(/id is required/);
  });

  test('a phone allowed only to read can still see the lines of work', async () => {
    await phone.grant(['read']);
    expect((await list()).map((w) => w.branch)).toEqual(expect.arrayContaining(['billing-v2', 'checkout-fix']));
  });
});
