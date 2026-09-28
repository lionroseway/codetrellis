/**
 * Breakpoints on code (Phase 32 B4.2), end to end: a real backend, two real
 * worktrees, the real connector run as Claude Code runs the hook, and a
 * second agent with no hook.
 *
 * Journey K1 and K2. Sam sets "ask me before touching packages/shared/".
 *  - Claude Code, in `billing-v2` with the hook, tries to edit a file there:
 *    the edit is denied as "paused: waiting for a decision". Sam answers with
 *    a steer; the hook lets the edit through with the note, and every later
 *    edit of that file too.
 *  - Codex, in `exports` with no hook, edits a file there with its own
 *    editor. Nothing could pause it, so its next tool call tells it to stop
 *    and wait, and the change is recorded as a breach, never as a pause. A
 *    file it changed before the breakpoint was set is not a breach.
 */

import { test, expect } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync, spawn } from 'node:child_process';
import { setupHarness, createMcpClient, REPO_ROOT, type Harness, type ScriptedMcp } from '../harness';

const SHARED = 'packages/shared/src/validators.ts';
const EARLIER = 'packages/shared/src/types.ts';
const ENV = { ...process.env, GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@x', GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@x' };

interface Hit { ref: string; action: string; path: string | null; breach: boolean; workstreamRoot: string | null; decision: string | null }

function runHook(dataDir: string, cwd: string, file: string): Promise<{ code: number | null; stdout: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ['--import', 'tsx', path.join(REPO_ROOT, 'src/backend/mcp/connector/main.ts'), '--data-dir', dataDir, '--hook', 'pre-tool-use'], {
      cwd: REPO_ROOT, stdio: ['pipe', 'pipe', 'ignore'],
    });
    let stdout = '';
    child.stdout.on('data', (d) => { stdout += d; });
    child.on('error', reject);
    child.on('close', (code) => resolve({ code, stdout }));
    child.stdin.end(JSON.stringify({
      session_id: 'cc-1', cwd, hook_event_name: 'PreToolUse', tool_name: 'Edit',
      tool_input: { file_path: path.join(cwd, file), old_string: 'x', new_string: 'y' },
    }));
  });
}

const hookOut = (stdout: string) => (stdout ? (JSON.parse(stdout) as { hookSpecificOutput: Record<string, string> }).hookSpecificOutput : null);

test.describe.serial('Breakpoints on code', () => {
  test.setTimeout(120_000);

  let h: Harness;
  let root: string;
  let billing: string;
  let exportsDir: string;
  let claude: ScriptedMcp;
  let codex: ScriptedMcp;
  let bpId: string;
  let heldRef: string;
  let breachRef: string;

  const hits = async (state = 'waiting') => ((await (await h.client.raw('GET', `/api/breakpoint-hits?state=${state}`)).json()) as { hits: Hit[] }).hits;
  const touch = (dir: string, file: string, marker: string) => fs.appendFileSync(path.join(dir, file), `\n// ${marker}\n`);

  test.beforeAll(async () => {
    h = await setupHarness('code-breakpoints', { env: { CODETRELLIS_WORKSTREAM_DEBOUNCE_MS: '150' } });
    root = h.fixture.projectPath;
    billing = `${root}-billing`;
    exportsDir = `${root}-exports`;
    for (const [dir, branch] of [[billing, 'billing-v2'], [exportsDir, 'exports']]) {
      execFileSync('git', ['-C', root, 'worktree', 'add', '-q', dir, '-b', branch], { env: ENV });
    }
    await h.client.scanProject(root);
    // Changed before any breakpoint exists: never a breach.
    touch(exportsDir, EARLIER, 'exports, before the breakpoint');
    await new Promise((r) => setTimeout(r, 50));
    claude = createMcpClient({ mcpPort: h.backend.mcpPort, capabilityToken: h.backend.capabilityToken, clientName: 'claude-code', roots: [billing] });
    codex = createMcpClient({ mcpPort: h.backend.mcpPort, capabilityToken: h.backend.capabilityToken, clientName: 'codex', roots: [exportsDir] });
    await claude.connect();
    await codex.connect();
  });

  test.afterAll(async () => {
    await claude?.disconnect().catch(() => {});
    await codex?.disconnect().catch(() => {});
    for (const w of [billing, exportsDir]) {
      try { execFileSync('git', ['-C', root, 'worktree', 'remove', '--force', w]); } catch { /* */ }
    }
    await h?.teardown();
  });

  test('a person sets a breakpoint on a folder of the opened project; paths outside it are refused', async () => {
    const res = await h.client.raw('POST', '/api/breakpoints', { kind: 'code', path: 'packages/shared', note: 'Ask me before touching shared', projectRoot: '/somewhere/else' });
    expect(res.status).toBe(201);
    const { breakpoint } = (await res.json()) as { breakpoint: { id: string; target: string; projectRoot: string; kind: string } };
    expect(breakpoint).toMatchObject({ kind: 'code', target: 'packages/shared/', projectRoot: root });
    bpId = breakpoint.id;
    expect((await h.client.raw('POST', '/api/breakpoints', { kind: 'code', path: '../outside' })).status).toBe(400);
    expect((await h.client.raw('POST', '/api/breakpoints', { kind: 'code', path: 'packages/nope.ts' })).status).toBe(404);
    expect((await h.client.raw('POST', '/api/breakpoints', { kind: 'code', path: 'packages/shared', symbol: 'validateCreateUser' })).status).toBe(400);
  });

  test('Claude Code with the hook: the edit is denied as paused, with the ref to wait on; asking again is the same wait', async () => {
    const first = await runHook(h.fixture.dataDir, billing, SHARED);
    expect(first.code).toBe(0);
    const out = hookOut(first.stdout)!;
    expect(out.permissionDecision).toBe('deny');
    expect(out.permissionDecisionReason).toContain('paused: waiting for a decision');
    expect(out.permissionDecisionReason).toContain(`before ${SHARED} changes. Their note: Ask me before touching shared`);
    heldRef = /ref "(bp-[0-9a-f]+)"/.exec(out.permissionDecisionReason)![1];
    expect(hookOut((await runHook(h.fixture.dataDir, billing, SHARED)).stdout)!.permissionDecisionReason).toContain(heldRef);

    const waiting = await hits();
    expect(waiting).toHaveLength(1);
    expect(waiting[0]).toMatchObject({ ref: heldRef, action: 'edit_code', path: SHARED, breach: false });
    expect(fs.realpathSync(waiting[0].workstreamRoot!)).toBe(fs.realpathSync(billing));
    // A file outside the breakpoint: nothing is said.
    expect((await runHook(h.fixture.dataDir, billing, 'packages/web/src/UserList.tsx')).stdout).toBe('');
  });

  test('a steer: the agent\'s wait returns it, the edit goes through with the note once, and later edits of the file too', async () => {
    const wait = claude.callTool('await_decision', { ref: heldRef, wait_seconds: 20 });
    expect((await h.client.raw('POST', `/api/breakpoint-hits/${heldRef}/answer`, { decision: 'steer', note: 'Only the email rule' })).status).toBe(200);
    expect(JSON.parse((await wait).answer)).toMatchObject({ status: 'answered', decision: 'steer', note: 'Only the email rule' });

    const through = hookOut((await runHook(h.fixture.dataDir, billing, SHARED)).stdout);
    expect(through?.permissionDecision).toBeUndefined();
    expect(through?.additionalContext).toContain('continue, with this steer: Only the email rule');
    const later = hookOut((await runHook(h.fixture.dataDir, billing, SHARED)).stdout);
    expect(later?.permissionDecision).toBeUndefined();
    expect(later?.additionalContext ?? '').not.toContain('steer');

    // The edit the hook let through is not a breach.
    touch(billing, SHARED, 'billing, allowed');
    await new Promise((r) => setTimeout(r, 400));
    expect((await claude.callTool('list_plans', {})).text).not.toContain('CodeTrellis breakpoint');
  });

  test('Codex without the hook: its next tool call says it changed a file past a breakpoint, recorded as a breach, once', async () => {
    touch(exportsDir, SHARED, 'exports, past the breakpoint');
    let text = '';
    await expect.poll(async () => {
      text = (await codex.callTool('list_plans', {})).text;
      return text.includes('CodeTrellis breakpoint');
    }, { timeout: 15_000, intervals: [400] }).toBe(true);
    expect(text).toContain(`You changed ${SHARED}, which has a breakpoint`);
    expect(text).toContain('recorded as a breach');
    expect(text).toContain('Their note on the breakpoint: Ask me before touching shared');
    expect(text).not.toContain(EARLIER);
    breachRef = /ref "(bp-[0-9a-f]+)"/.exec(text)![1];
    expect((await codex.callTool('list_plans', {})).text).not.toContain('CodeTrellis breakpoint');

    const breach = (await hits()).find((x) => x.ref === breachRef)!;
    expect(breach).toMatchObject({ action: 'breach', breach: true, path: SHARED });
    expect(fs.realpathSync(breach.workstreamRoot!)).toBe(fs.realpathSync(exportsDir));
  });

  test('the person answers the breach with stop; the agent is told to stop and say what it changed', async () => {
    expect((await h.client.raw('POST', `/api/breakpoint-hits/${breachRef}/answer`, { decision: 'stop', note: 'Revert it, shared is frozen' })).status).toBe(200);
    const view = JSON.parse((await codex.callTool('await_decision', { ref: breachRef, wait_seconds: 2 })).answer) as Record<string, string>;
    expect(view).toMatchObject({ status: 'answered', decision: 'stop', note: 'Revert it, shared is frozen' });
    expect(view.message).toContain(`Stop changing ${SHARED}. Tell the person what you changed there`);
  });

  test('on the Timeline: a pause and a breach, never one for the other', async () => {
    let events: Array<{ type: string; payload: Record<string, unknown> }> = [];
    await expect.poll(async () => {
      events = ((await (await h.client.raw('GET', '/api/agent-events')).json()) as { events: typeof events }).events;
      return events.filter((e) => e.type === 'breakpoint_answered').length;
    }, { timeout: 10_000 }).toBe(2);
    const hitEvents = events.filter((e) => e.type === 'breakpoint_hit');
    expect(hitEvents.map((e) => [e.payload.action, e.payload.breach ?? false])).toEqual([['edit_code', false], ['breach', true]]);
    expect(hitEvents.every((e) => e.payload.path === SHARED)).toBe(true);
  });

  test('clearing the breakpoint: the hook says nothing more about it, and an agent asking is told it may edit', async () => {
    // Any agent may ask before editing: a file outside the breakpoint is open.
    expect(JSON.parse((await codex.callTool('check_breakpoint', { path: 'packages/web/src/UserList.tsx' })).answer)).toEqual({ status: 'pass' });
    expect((await h.client.raw('DELETE', `/api/breakpoints/${bpId}`)).status).toBe(200);
    expect(JSON.parse((await codex.callTool('check_breakpoint', { path: SHARED })).answer)).toEqual({ status: 'pass' });
    const out = hookOut((await runHook(h.fixture.dataDir, billing, 'packages/shared/src/index.ts')).stdout);
    expect(out?.permissionDecision).toBeUndefined();
    expect(await hits()).toEqual([]);
  });
});
