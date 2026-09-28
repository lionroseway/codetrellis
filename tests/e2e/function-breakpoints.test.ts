/**
 * Breakpoints on one function (Phase 32 B4.2c), end to end: the real parser,
 * the real connector run as Claude Code's hook, and an agent with no hook.
 *
 * Sam sets "ask me before validateCreateUser changes". In the same file,
 * validateCreateOrder is open:
 *  - Claude Code's edit inside validateCreateOrder goes ahead; its edit
 *    inside validateCreateUser is paused, naming the function; a whole-file
 *    write, which could touch anything, is held too.
 *  - Codex, with no hook, changes validateCreateOrder: nothing. Then it
 *    changes validateCreateUser: a breach, naming the function.
 */

import { test, expect } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync, spawn } from 'node:child_process';
import { setupHarness, createMcpClient, REPO_ROOT, type Harness, type ScriptedMcp } from '../harness';

const FILE = 'packages/shared/src/validators.ts';
const IN_USER = "errors.push('name is required');";
const IN_ORDER = "errors.push('amount must be a positive number');";
const ENV = { ...process.env, GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@x', GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@x' };

function runHook(dataDir: string, cwd: string, toolInput: Record<string, unknown>, tool = 'Edit'): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ['--import', 'tsx', path.join(REPO_ROOT, 'src/backend/mcp/connector/main.ts'), '--data-dir', dataDir, '--hook', 'pre-tool-use'], {
      cwd: REPO_ROOT, stdio: ['pipe', 'pipe', 'ignore'],
    });
    let stdout = '';
    child.stdout.on('data', (d) => { stdout += d; });
    child.on('error', reject);
    child.on('close', () => resolve(stdout));
    child.stdin.end(JSON.stringify({ session_id: 'cc-1', cwd, hook_event_name: 'PreToolUse', tool_name: tool, tool_input: { file_path: path.join(cwd, FILE), ...toolInput } }));
  });
}
const decision = (stdout: string) => (stdout ? (JSON.parse(stdout) as { hookSpecificOutput: Record<string, string> }).hookSpecificOutput : null);

test.describe.serial('Breakpoints on one function', () => {
  test.setTimeout(120_000);

  let h: Harness;
  let root: string;
  let billing: string;
  let exportsDir: string;
  let codex: ScriptedMcp;

  const edit = (dir: string, from: string, to: string) => {
    const f = path.join(dir, FILE);
    fs.writeFileSync(f, fs.readFileSync(f, 'utf-8').replace(from, to));
  };

  test.beforeAll(async () => {
    h = await setupHarness('function-breakpoints', { env: { CODETRELLIS_WORKSTREAM_DEBOUNCE_MS: '150' } });
    root = h.fixture.projectPath;
    billing = `${root}-billing`;
    exportsDir = `${root}-exports`;
    for (const [dir, branch] of [[billing, 'billing-v2'], [exportsDir, 'exports']]) {
      execFileSync('git', ['-C', root, 'worktree', 'add', '-q', dir, '-b', branch], { env: ENV });
    }
    await h.client.scanProject(root);
    codex = createMcpClient({ mcpPort: h.backend.mcpPort, capabilityToken: h.backend.capabilityToken, clientName: 'codex', roots: [exportsDir] });
    await codex.connect();
    const res = await h.client.raw('POST', '/api/breakpoints', { kind: 'code', path: FILE, symbol: 'validateCreateUser', note: 'User rules are frozen' });
    expect(res.status).toBe(201);
    expect(((await res.json()) as { breakpoint: { target: string } }).breakpoint.target).toBe(`${FILE}#validateCreateUser`);
  });

  test.afterAll(async () => {
    await codex?.disconnect().catch(() => {});
    for (const w of [billing, exportsDir]) {
      try { execFileSync('git', ['-C', root, 'worktree', 'remove', '--force', w]); } catch { /* */ }
    }
    await h?.teardown();
  });

  test('Claude Code: an edit in another function of the file goes ahead', async () => {
    const out = decision(await runHook(h.fixture.dataDir, billing, { old_string: IN_ORDER, new_string: IN_ORDER.replace('amount', 'total') }));
    expect(out?.permissionDecision).toBeUndefined();
  });

  test('an edit inside the function is paused, naming it; a whole-file write is the same wait', async () => {
    const held = decision(await runHook(h.fixture.dataDir, billing, { old_string: IN_USER, new_string: IN_USER.replace('name', 'full name') }))!;
    expect(held.permissionDecision).toBe('deny');
    expect(held.permissionDecisionReason).toContain(`before validateCreateUser in ${FILE} changes. Their note: User rules are frozen`);
    const ref = /ref "(bp-[0-9a-f]+)"/.exec(held.permissionDecisionReason)![1];
    const write = decision(await runHook(h.fixture.dataDir, billing, { content: 'export {};\n' }, 'Write'))!;
    expect(write.permissionDecision).toBe('deny');
    expect(write.permissionDecisionReason).toContain(ref);
  });

  test('Codex without the hook: changing the other function is no breach; changing this one is, by name', async () => {
    edit(exportsDir, IN_ORDER, "errors.push('amount must be above zero');");
    await new Promise((r) => setTimeout(r, 600));
    expect((await codex.callTool('list_plans', {})).text).not.toContain('CodeTrellis breakpoint');

    edit(exportsDir, IN_USER, "errors.push('a name is required');");
    let text = '';
    await expect.poll(async () => {
      text = (await codex.callTool('list_plans', {})).text;
      return text.includes('CodeTrellis breakpoint');
    }, { timeout: 15_000, intervals: [400] }).toBe(true);
    expect(text).toContain(`You changed validateCreateUser in ${FILE}, which has a breakpoint`);
    expect(text).toContain('recorded as a breach');
  });
});
