/**
 * Intended and cooldown (Phase 32 A3.2), end to end: two worktrees, a person
 * answering over REST, an agent bound to one side over MCP.
 *
 * An answered signal stays quiet while what it is about keeps its shape (a
 * body edit), and needs the person again when the shape changes (a new
 * function in the file): it opens, says why, and the agent is told again.
 */

import { test, expect } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { setupHarness, createMcpClient, type Harness, type ScriptedMcp } from '../harness';

interface Signal { id: string; kind: string; severity: string; state: string; reopened?: { from: string; at: number }; subject: { file?: string; symbol?: string } }

const REL = 'packages/shared/src/validators.ts';
const NOTICE = '── CodeTrellis awareness ──';
const ENV = { ...process.env, GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@x', GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@x' };

test.describe.serial('Intended and cooldown', () => {
  test.setTimeout(120_000);

  let h: Harness;
  let root: string;
  let auth: string;
  let billing: string;
  let agent: ScriptedMcp; // in auth
  let id: string;

  const signals = async () => {
    const res = await h.client.raw('GET', `/api/awareness?project=${encodeURIComponent(root)}`);
    return ((await res.json()) as { signals: Signal[] }).signals.filter((s) => s.kind === 'collision');
  };
  const answer = (sid: string, state: string) =>
    h.client.raw('POST', `/api/awareness/${sid}/state?project=${encodeURIComponent(root)}`, { state });
  const edit = (folder: string, from: string, to: string) => {
    const f = path.join(folder, REL);
    const was = fs.readFileSync(f, 'utf-8');
    expect(was.includes(from), `${REL} contains the text to change`).toBe(true);
    fs.writeFileSync(f, was.replace(from, to));
  };

  test.beforeAll(async () => {
    h = await setupHarness('awareness-cooldown', { env: { CODETRELLIS_WORKSTREAM_DEBOUNCE_MS: '150' } });
    root = h.fixture.projectPath;
    auth = `${root}-auth`;
    billing = `${root}-billing`;
    for (const [dir, branch] of [[auth, 'auth-refresh'], [billing, 'billing-v2']]) {
      execFileSync('git', ['-C', root, 'worktree', 'add', '-q', dir, '-b', branch], { env: ENV });
    }
    await h.client.scanProject(root);
    agent = createMcpClient({ mcpPort: h.backend.mcpPort, capabilityToken: h.backend.capabilityToken, clientName: 'codex', roots: [auth] });
    await agent.connect();
    // Different functions of one file: a medium, file-level collision.
    edit(auth, 'return EMAIL_RE.test(email);', 'return EMAIL_RE.test(email.trim());');
    edit(billing, "errors.push('name is required');", "errors.push('name is required (billing)');");
  });

  test.afterAll(async () => {
    await agent?.disconnect().catch(() => {});
    for (const w of [auth, billing]) {
      try { execFileSync('git', ['-C', root, 'worktree', 'remove', '--force', w]); } catch { /* */ }
    }
    await h?.teardown();
  });

  test('the person acknowledges the overlap, and the agent has been told about it', async () => {
    await expect.poll(async () => (await signals()).length, { timeout: 10_000 }).toBe(1);
    const [s] = await signals();
    id = s.id;
    expect(s).toMatchObject({ severity: 'medium', subject: { file: REL } });
    expect((await answer(id, 'acknowledged')).status).toBe(200);
    // Reading it is being told (A2.6): nothing repeats it on later calls.
    await agent.callTool('get_awareness', {});
    expect((await agent.callTool('list_plans', {})).text).not.toContain(NOTICE);
  });

  test('a body edit on either side keeps its shape: it stays acknowledged, and nobody is told again', async () => {
    edit(billing, "errors.push('name is required (billing)');", "errors.push('a name is required (billing)');");
    edit(auth, 'return EMAIL_RE.test(email.trim());', 'return EMAIL_RE.test(email.trim().toLowerCase());');
    for (let i = 0; i < 5; i++) {
      const [s] = await signals();
      expect(s).toMatchObject({ id, state: 'acknowledged' });
      expect(s.reopened).toBeUndefined();
      expect((await agent.callTool('list_plans', {})).text).not.toContain(NOTICE);
      await new Promise((r) => setTimeout(r, 400));
    }
  });

  test('a new function in the file changes its shape: it is back, says why, and the agent is told again', async () => {
    edit(billing, 'export function validateCreateOrder(', 'export function validateCurrency(code: string): boolean { return code.length === 3; }\n\nexport function validateCreateOrder(');
    await expect.poll(async () => (await signals()).find((s) => s.id === id)?.state, { timeout: 10_000 }).toBe('open');
    const [s] = await signals();
    expect(s.reopened).toMatchObject({ from: 'acknowledged' });
    let told = '';
    await expect.poll(async () => {
      told = (await agent.callTool('list_plans', {})).text;
      return told.includes(NOTICE);
    }, { timeout: 10_000, intervals: [300] }).toBe(true);
    expect(told).toContain('medium collision');
  });

  test('intended, then the same: quiet through a body edit, back when the shape changes', async () => {
    expect((await answer(id, 'intended')).status).toBe(200);
    const [after] = await signals();
    expect(after.reopened, 'a new answer replaces why it was back').toBeUndefined();
    edit(billing, 'return code.length === 3;', 'return code.trim().length === 3;');
    await new Promise((r) => setTimeout(r, 1200));
    expect((await signals())[0]).toMatchObject({ id, state: 'intended' });
    edit(auth, 'export function isValidEmail(', 'export function normaliseEmail(e: string): string { return e.trim(); }\n\nexport function isValidEmail(');
    await expect.poll(async () => (await signals())[0]?.reopened?.from, { timeout: 10_000 }).toBe('intended');
  });
});
