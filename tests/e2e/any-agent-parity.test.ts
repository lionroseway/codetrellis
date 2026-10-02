/**
 * Any agent (Phase 32 A8.1): every awareness and breakpoint journey, run by a
 * plain MCP client, `codex`, with no hook and no session watcher. One test per
 * row of the parity table in docs/claude/awareness.md.
 *
 * Two worktrees of the fixture: Codex works in billing-v2; a second Codex
 * works in exports. Both change validateCreateOrder in validators.ts.
 */

import { test, expect } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { setupHarness, createMcpClient, type Harness, type ScriptedMcp } from '../harness';

const REL = 'packages/shared/src/validators.ts';
const IN_USER = "errors.push('name is required');";
const IN_ORDER = "errors.push('amount must be a positive number');";
const ENV = { ...process.env, GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@x', GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@x' };

test.describe.serial('Any agent: the journeys with no hook', () => {
  test.setTimeout(120_000);

  let h: Harness;
  let root: string;
  let billing: string;
  let exportsDir: string;
  let codex: ScriptedMcp;
  let codexExports: ScriptedMcp;

  const raw = (method: string, url: string, body?: unknown) => h.client.raw(method, url, body);
  const json = async <T>(method: string, url: string, body?: unknown) => (await (await raw(method, url, body)).json()) as T;
  const answer = async (client: ScriptedMcp, tool: string, args: Record<string, unknown>) => JSON.parse((await client.callTool(tool, args)).answer) as Record<string, unknown>;
  const edit = (dir: string, from: string, to: string) => {
    const f = path.join(dir, REL);
    fs.writeFileSync(f, fs.readFileSync(f, 'utf-8').replace(from, to));
  };
  const same = (a: unknown, b: string) => typeof a === 'string' && fs.realpathSync(a) === fs.realpathSync(b);

  test.beforeAll(async () => {
    h = await setupHarness('any-agent-parity', { env: { CODETRELLIS_WORKSTREAM_DEBOUNCE_MS: '150' } });
    root = h.fixture.projectPath;
    billing = `${root}-billing`;
    exportsDir = `${root}-exports`;
    for (const [dir, branch] of [[billing, 'billing-v2'], [exportsDir, 'exports']]) {
      execFileSync('git', ['-C', root, 'worktree', 'add', '-q', dir, '-b', branch], { env: ENV });
    }
    await h.client.scanProject(root);
    codex = createMcpClient({ mcpPort: h.backend.mcpPort, capabilityToken: h.backend.capabilityToken, clientName: 'codex', roots: [billing] });
    codexExports = createMcpClient({ mcpPort: h.backend.mcpPort, capabilityToken: h.backend.capabilityToken, clientName: 'codex', roots: [exportsDir] });
    await codex.connect();
    await codexExports.connect();
  });

  test.afterAll(async () => {
    await codex?.disconnect().catch(() => {});
    await codexExports?.disconnect().catch(() => {});
    for (const w of [billing, exportsDir]) {
      try { execFileSync('git', ['-C', root, 'worktree', 'remove', '--force', w]); } catch { /* */ }
    }
    await h?.teardown();
  });

  test('workstreams and signals: it sees its own worktree, the other one, and the overlap between them', async () => {
    edit(billing, IN_ORDER, "errors.push('amount must be above zero');");
    edit(exportsDir, IN_ORDER, "errors.push('amount must be a number above zero');");
    // Each agent's worktree is watched from when it connected, so the listing
    // follows the edits after the watcher's debounce, as with the window open.
    let listed = { workstreams: [] as Array<{ root: string; branch: string; yours: boolean }> };
    await expect.poll(async () => {
      listed = await answer(codex, 'list_workstreams', {}) as typeof listed;
      return listed.workstreams.map((w) => w.branch);
    }, { timeout: 15_000 }).toEqual(expect.arrayContaining(['billing-v2', 'exports']));
    const mine = listed.workstreams.find((w) => w.yours);
    expect(same(mine?.root, billing)).toBe(true);

    let aware: { your_workstream: string; signals: Array<{ kind: string; subject: { file?: string; symbol?: string } }> } = { your_workstream: '', signals: [] };
    await expect.poll(async () => {
      aware = await answer(codex, 'get_awareness', {}) as typeof aware;
      return aware.signals.map((s) => `${s.kind} ${s.subject.file}#${s.subject.symbol ?? ''}`);
    }, { timeout: 15_000 }).toEqual([`collision ${REL}#validateCreateOrder`]);
    expect(same(aware.your_workstream, billing)).toBe(true);
  });

  test('line changes: it is told the other side\'s lines, in words, from git', async () => {
    const lines = await answer(codex, 'get_line_changes', { path: REL }) as { says: string[] };
    expect(lines.says).toEqual(['exports changed line 19, in validateCreateOrder, not committed']);
  });

  test('a task breakpoint: its claim is paused, and goes through once the person says continue', async () => {
    const planUid = (await h.client.createPlan({ title: 'Checkout', projectPath: root })).uid;
    const refunds = (await json<{ uid: string }>('POST', `/api/plans/${planUid}/items`, { kind: 'action', title: 'Partial refunds' })).uid;
    expect((await raw('POST', '/api/breakpoints', { kind: 'task', itemUid: refunds, note: 'Ask me first' })).status).toBe(201);

    const held = await answer(codex, 'claim_item', { uid: refunds });
    expect(held).toMatchObject({ paused: true, status: 'paused: waiting for a decision' });
    const ref = String(held.ref);
    const wait = codex.callTool('await_decision', { ref, wait_seconds: 20 });
    expect((await raw('POST', `/api/breakpoint-hits/${ref}/answer`, { decision: 'continue' })).status).toBe(200);
    expect(JSON.parse((await wait).answer)).toMatchObject({ status: 'answered', decision: 'continue' });
    expect(await answer(codex, 'claim_item', { uid: refunds })).toMatchObject({ ok: true });
  });

  test('a function breakpoint: check_breakpoint with the text it replaces holds only an edit of that function', async () => {
    expect((await raw('POST', '/api/breakpoints', { kind: 'code', path: REL, symbol: 'validateCreateUser', note: 'User rules are frozen' })).status).toBe(201);
    // The edit of the other function: go ahead.
    expect(await answer(codex, 'check_breakpoint', { path: REL, old_text: ["errors.push('amount must be above zero');"] })).toEqual({ status: 'pass' });
    // An edit of this one: paused, naming it, with the ref to wait on.
    const held = await answer(codex, 'check_breakpoint', { path: REL, old_text: [IN_USER] });
    expect(held.status).toBe('paused');
    expect(String(held.message)).toContain(`validateCreateUser in ${REL}`);
    const ref = String(held.ref);
    expect((await raw('POST', `/api/breakpoint-hits/${ref}/answer`, { decision: 'steer', note: 'Only the message wording' })).status).toBe(200);
    expect(JSON.parse((await codex.callTool('await_decision', { ref, wait_seconds: 5 })).answer)).toMatchObject({ decision: 'steer', note: 'Only the message wording' });
    expect(await answer(codex, 'check_breakpoint', { path: REL, old_text: [IN_USER] })).toMatchObject({ status: 'continue', steer: 'Only the message wording' });
  });

  test('a breach: an agent that edits past a breakpoint with its own editor is told on its next call', async () => {
    edit(exportsDir, IN_USER, "errors.push('a name is required');");
    let text = '';
    await expect.poll(async () => {
      text = (await codexExports.callTool('list_plans', {})).text;
      return text.includes('CodeTrellis breakpoint');
    }, { timeout: 15_000, intervals: [400] }).toBe(true);
    expect(text).toContain(`You changed validateCreateUser in ${REL}, which has a breakpoint`);
    expect(text).toContain('recorded as a breach');
  });

  test('the guide tells every agent to check before an edit, whatever its client', async () => {
    const summary = (await codex.callTool('get_app_guide', {})).text;
    expect(summary).toContain('Before you edit a file, call `check_breakpoint(path, old_text)`, whatever\nyour client');
    const parallel = (await codex.callTool('get_app_guide', { flavor: 'parallel' })).text;
    expect(parallel).toContain('Before you edit a file, call\n   `check_breakpoint(path, old_text)`');
  });
});
