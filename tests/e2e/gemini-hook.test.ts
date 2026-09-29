/**
 * The breakpoint hook for Gemini CLI (Phase 32 A8.3), end to end: the real
 * connector, run the way Gemini CLI runs a `BeforeTool` command hook (its
 * input on stdin, as @google/gemini-cli-core 0.61.0 writes it), against the
 * running app.
 *
 *   <connector> --hook gemini-before-tool
 *
 * Sam asks to be asked before validateCreateUser changes. A `replace` of it
 * is denied with the reason; a `replace` of another function and a
 * `write_file` Sam set no breakpoint on go ahead with nothing printed; once
 * Sam answers continue the replace goes ahead. With the app not running,
 * nothing is printed and it exits 0.
 */

import { test, expect } from '@playwright/test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { setupHarness, REPO_ROOT, type Harness } from '../harness';

const FILE = 'packages/shared/src/validators.ts';

function beforeTool(dataDir: string, cwd: string, tool: string, toolInput: Record<string, unknown>): Promise<{ code: number | null; stdout: string; stderr: string }> {
  const input = JSON.stringify({
    session_id: 'g-1', transcript_path: path.join(os.tmpdir(), 'g-1.json'), cwd, hook_event_name: 'BeforeTool',
    timestamp: new Date().toISOString(), tool_name: tool, tool_input: toolInput,
  });
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ['--import', 'tsx', path.join(REPO_ROOT, 'src/backend/mcp/connector/main.ts'), '--data-dir', dataDir, '--hook', 'gemini-before-tool'],
      { cwd, stdio: ['pipe', 'pipe', 'pipe'], env: { ...process.env, NODE_OPTIONS: '' } });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (d) => { stdout += d; });
    child.stderr.on('data', (d) => { stderr += d; });
    child.on('error', reject);
    child.on('close', (code) => resolve({ code, stdout: stdout.trim(), stderr: stderr.trim() }));
    child.stdin.end(input);
  });
}

test.describe.serial('The breakpoint hook for Gemini CLI', () => {
  test.setTimeout(120_000);

  let h: Harness;
  let root: string;
  let ref: string;

  test.beforeAll(async () => {
    h = await setupHarness('gemini-hook');
    root = h.fixture.projectPath;
    await h.client.scanProject(root);
    const res = await h.client.raw('POST', '/api/breakpoints', { kind: 'code', path: FILE, symbol: 'validateCreateUser', note: 'User rules are frozen' });
    expect(res.status).toBe(201);
  });

  test.afterAll(async () => { await h?.teardown(); });

  test('held: a replace of the function is denied, with the reason the model reads', async () => {
    const r = await beforeTool(h.fixture.dataDir, root, 'replace', { file_path: path.join(root, FILE), old_string: "errors.push('name is required');", new_string: "errors.push('a name is required');", instruction: 'reword' });
    expect(r.code).toBe(0);
    const out = JSON.parse(r.stdout) as { decision: string; reason: string };
    expect(out.decision).toBe('deny');
    expect(out.reason).toContain(`before validateCreateUser in ${FILE} changes. Their note: User rules are frozen`);
    ref = /ref "(bp-[0-9a-f]+)"/.exec(out.reason)![1];
  });

  test('another function, and a file with no breakpoint, go ahead: nothing printed', async () => {
    const other = await beforeTool(h.fixture.dataDir, root, 'replace', { file_path: FILE, old_string: "errors.push('amount must be a positive number');", new_string: 'x' });
    expect(other).toEqual({ code: 0, stdout: '', stderr: '' });
    const write = await beforeTool(h.fixture.dataDir, root, 'write_file', { file_path: 'packages/shared/src/new.ts', content: 'export {};\n' });
    expect(write).toEqual({ code: 0, stdout: '', stderr: '' });
  });

  test('released: once the person says continue, the replace goes ahead', async () => {
    expect((await h.client.raw('POST', `/api/breakpoint-hits/${ref}/answer`, { decision: 'continue' })).status).toBe(200);
    const r = await beforeTool(h.fixture.dataDir, root, 'replace', { file_path: path.join(root, FILE), old_string: "errors.push('name is required');", new_string: 'y' });
    expect(r).toEqual({ code: 0, stdout: '', stderr: '' });
  });

  test('the app not running: exit 0 and nothing printed', async () => {
    const empty = fs.mkdtempSync(path.join(os.tmpdir(), 'ct-no-app-'));
    const r = await beforeTool(empty, root, 'replace', { file_path: path.join(root, FILE), old_string: "errors.push('name is required');", new_string: 'y' });
    expect(r).toEqual({ code: 0, stdout: '', stderr: '' });
  });
});
