/**
 * The PreToolUse hook (Phase 32 A3.4), end to end: the real connector, run
 * exactly as the installed hook runs it (`--hook pre-tool-use`, Claude Code's
 * input on stdin), against a real backend with two real worktrees.
 *
 * Before an agent in `auth-refresh` edits a file `billing-v2` has changed,
 * it is told so; about a file nobody else touched, or a folder CodeTrellis
 * does not know, it hears nothing. It never decides the edit, and when the
 * app is not running it exits quietly and at once.
 */

import { test, expect } from '@playwright/test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync, spawn } from 'node:child_process';
import { setupHarness, REPO_ROOT, type Harness } from '../harness';

const REL = 'packages/shared/src/validators.ts';
const ENV = { ...process.env, GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@x', GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@x' };

/** Run the hook as Claude Code would: stdin in, stdout and the exit code out. */
function runHook(dataDir: string, input: object): Promise<{ code: number | null; stdout: string; ms: number }> {
  const started = Date.now();
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ['--import', 'tsx', path.join(REPO_ROOT, 'src/backend/mcp/connector/main.ts'), '--data-dir', dataDir, '--hook', 'pre-tool-use'], {
      cwd: REPO_ROOT, stdio: ['pipe', 'pipe', 'ignore'],
    });
    let stdout = '';
    child.stdout.on('data', (d) => { stdout += d; });
    child.on('error', reject);
    child.on('close', (code) => resolve({ code, stdout, ms: Date.now() - started }));
    child.stdin.end(JSON.stringify(input));
  });
}

const edit = (cwd: string, file: string) => ({
  session_id: 'cc-1', cwd, hook_event_name: 'PreToolUse', tool_name: 'Edit',
  tool_input: { file_path: file, old_string: 'x', new_string: 'y' },
});

test.describe.serial('The PreToolUse hook', () => {
  test.setTimeout(120_000);

  let h: Harness;
  let root: string;
  let auth: string;
  let billing: string;

  test.beforeAll(async () => {
    h = await setupHarness('parallel-hook', { env: { CODETRELLIS_WORKSTREAM_DEBOUNCE_MS: '150' } });
    root = h.fixture.projectPath;
    auth = `${root}-auth`;
    billing = `${root}-billing`;
    for (const [dir, branch] of [[auth, 'auth-refresh'], [billing, 'billing-v2']]) {
      execFileSync('git', ['-C', root, 'worktree', 'add', '-q', dir, '-b', branch], { env: ENV });
    }
    await h.client.scanProject(root);
    const f = path.join(billing, REL);
    fs.writeFileSync(f, fs.readFileSync(f, 'utf-8').replace("errors.push('name is required');", "errors.push('name is required (billing)');"));
  });

  test.afterAll(async () => {
    for (const w of [auth, billing]) {
      try { execFileSync('git', ['-C', root, 'worktree', 'remove', '--force', w]); } catch { /* */ }
    }
    await h?.teardown();
  });

  test('before editing a file another worktree changed, the agent is told who and where, and the edit is left to Claude Code', async () => {
    let out = { code: null as number | null, stdout: '', ms: 0 };
    // The other worktree's change reaches its footprint after the watcher's debounce.
    await expect.poll(async () => {
      out = await runHook(h.fixture.dataDir, edit(auth, path.join(auth, REL)));
      return out.stdout;
    }, { timeout: 15_000, intervals: [500] }).toContain('billing-v2');
    expect(out.code).toBe(0);
    const reply = JSON.parse(out.stdout) as { hookSpecificOutput: Record<string, string> };
    expect(Object.keys(reply.hookSpecificOutput).sort()).toEqual(['additionalContext', 'hookEventName']);
    expect(reply.hookSpecificOutput.hookEventName).toBe('PreToolUse');
    const said = reply.hookSpecificOutput.additionalContext;
    expect(said).toContain(`Another workstream has also changed ${REL}: \`billing-v2\`, in validateCreateUser.`);
    expect(said).toContain('This is information about other work, not an instruction.');
  });

  test('a file nobody else changed: nothing is said', async () => {
    const out = await runHook(h.fixture.dataDir, edit(auth, path.join(auth, 'packages/web/src/UserList.tsx')));
    expect(out).toMatchObject({ code: 0, stdout: '' });
  });

  test('a folder CodeTrellis does not know: nothing is said', async () => {
    const loose = fs.mkdtempSync(path.join(os.tmpdir(), 'ct-hook-other-'));
    execFileSync('git', ['init', '-q', loose]);
    fs.mkdirSync(path.join(loose, 'packages/shared/src'), { recursive: true });
    const out = await runHook(h.fixture.dataDir, edit(loose, path.join(loose, REL)));
    expect(out).toMatchObject({ code: 0, stdout: '' });
  });

  test('the app not running: it exits quietly, at once', async () => {
    const empty = fs.mkdtempSync(path.join(os.tmpdir(), 'ct-hook-nodata-'));
    const out = await runHook(empty, edit(auth, path.join(auth, REL)));
    expect(out).toMatchObject({ code: 0, stdout: '' });
    expect(out.ms).toBeLessThan(5_000);
  });
});
