/**
 * A pre-edit check any client can run (Phase 32 A8.2), end to end: the real
 * connector, run the way a client's hook or a wrapper script would, against
 * the running app.
 *
 *   <connector> --check-edit <path> [--old-text-file f]
 *
 * Sam asks to be asked before validateCreateUser changes. The check exits 2
 * with the reason for an edit of it, and 0 for an edit of another function;
 * once Sam answers continue it exits 0 with his steer. With the app not
 * running it exits 0 and prints nothing.
 */

import { test, expect } from '@playwright/test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { setupHarness, REPO_ROOT, type Harness } from '../harness';

const FILE = 'packages/shared/src/validators.ts';

function checkEdit(dataDir: string, cwd: string, file: string, oldText?: string): Promise<{ code: number | null; stdout: string; stderr: string }> {
  const args = [path.join(REPO_ROOT, 'src/backend/mcp/connector/main.ts'), '--data-dir', dataDir, '--check-edit', file];
  if (oldText !== undefined) {
    const f = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'ct-old-')), 'old.txt');
    fs.writeFileSync(f, oldText);
    args.push('--old-text-file', f);
  }
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ['--import', 'tsx', ...args], { cwd, stdio: ['ignore', 'pipe', 'pipe'], env: { ...process.env, NODE_OPTIONS: '' } });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (d) => { stdout += d; });
    child.stderr.on('data', (d) => { stderr += d; });
    child.on('error', reject);
    child.on('close', (code) => resolve({ code, stdout: stdout.trim(), stderr: stderr.trim() }));
  });
}

test.describe.serial('A pre-edit check any client can run', () => {
  test.setTimeout(120_000);

  let h: Harness;
  let root: string;
  let ref: string;

  test.beforeAll(async () => {
    h = await setupHarness('check-edit');
    root = h.fixture.projectPath;
    await h.client.scanProject(root);
    const res = await h.client.raw('POST', '/api/breakpoints', { kind: 'code', path: FILE, symbol: 'validateCreateUser', note: 'User rules are frozen' });
    expect(res.status).toBe(201);
  });

  test.afterAll(async () => { await h?.teardown(); });

  test('held: an edit of the function exits 2, the reason on stderr', async () => {
    // Run from the worktree with a relative path, as a hook in that folder would.
    const r = await checkEdit(h.fixture.dataDir, root, FILE, "errors.push('name is required');");
    expect(r.code).toBe(2);
    expect(r.stderr).toContain(`before validateCreateUser in ${FILE} changes. Their note: User rules are frozen`);
    ref = /ref "(bp-[0-9a-f]+)"/.exec(r.stderr)![1];
    expect(r.stdout).toBe('');
  });

  test('another function of the same file goes ahead: exit 0, nothing printed', async () => {
    const r = await checkEdit(h.fixture.dataDir, root, path.join(root, FILE), "errors.push('amount must be a positive number');");
    expect(r).toEqual({ code: 0, stdout: '', stderr: '' });
  });

  test('released: once the person says continue, exit 0 with the steer', async () => {
    expect((await h.client.raw('POST', `/api/breakpoint-hits/${ref}/answer`, { decision: 'steer', note: 'Only the wording' })).status).toBe(200);
    const r = await checkEdit(h.fixture.dataDir, root, FILE, "errors.push('name is required');");
    expect(r.code).toBe(0);
    expect(r.stdout).toContain('continue, with this steer: Only the wording');
  });

  test('the app not running: exit 0 and nothing printed', async () => {
    const empty = fs.mkdtempSync(path.join(os.tmpdir(), 'ct-no-app-'));
    const r = await checkEdit(empty, root, FILE, "errors.push('name is required');");
    expect(r).toEqual({ code: 0, stdout: '', stderr: '' });
  });
});
