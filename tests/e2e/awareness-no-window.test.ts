/**
 * Told with no window open: an agent that connects is watched from then.
 *
 * The workstream watchers used to start only when something listed the lines
 * of work, the window's strip or `list_workstreams`. With no window (a
 * headless backend, `codetrellis start`) two agents could connect, one could
 * change a function the other's work imports, and nobody was told, because
 * nothing had listed them. Connecting is now the discovery pass for the
 * agent's own repository. Nothing here lists workstreams or asks for
 * awareness before the notice arrives.
 */

import { test, expect } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { setupHarness, createMcpClient, type Harness, type ScriptedMcp } from '../harness';

const VALIDATORS = 'packages/shared/src/validators.ts';
const USER_LIST = 'packages/web/src/UserList.tsx';
const NOTICE = '── CodeTrellis awareness ──';
const ENV = { ...process.env, GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@x', GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@x' };

test.describe.serial('Told with no window open', () => {
  test.setTimeout(120_000);

  let h: Harness;
  let root: string;
  let billing: string;
  let checkout: string;
  let changer: ScriptedMcp;
  let caller: ScriptedMcp;

  const edit = (folder: string, rel: string, from: string, to: string) => {
    const f = path.join(folder, rel);
    const was = fs.readFileSync(f, 'utf-8');
    expect(was.includes(from), `${rel} contains the text to change`).toBe(true);
    fs.writeFileSync(f, was.replace(from, to));
  };

  test.beforeAll(async () => {
    h = await setupHarness('awareness-no-window', { env: { CODETRELLIS_WORKSTREAM_DEBOUNCE_MS: '150' } });
    root = h.fixture.projectPath;
    billing = `${root}-billing`;
    checkout = `${root}-checkout`;
    for (const [dir, branch] of [[billing, 'billing-v2'], [checkout, 'checkout-fix']]) {
      execFileSync('git', ['-C', root, 'worktree', 'add', '-q', dir, '-b', branch], { env: ENV });
    }
    await h.client.scanProject(root);
    edit(checkout, USER_LIST, "import { validateCreateUser } from '@sample/shared';", "import { validateCreateUser } from '@sample/shared';\n// checkout-fix: the signup form");
    changer = createMcpClient({ mcpPort: h.backend.mcpPort, capabilityToken: h.backend.capabilityToken, clientName: 'claude-code', roots: [billing] });
    caller = createMcpClient({ mcpPort: h.backend.mcpPort, capabilityToken: h.backend.capabilityToken, clientName: 'codex', roots: [checkout] });
    await changer.connect();
    await caller.connect();
  });

  test.afterAll(async () => {
    await changer?.disconnect().catch(() => {});
    await caller?.disconnect().catch(() => {});
    for (const w of [billing, checkout]) {
      try { execFileSync('git', ['-C', root, 'worktree', 'remove', '--force', w]); } catch { /* */ }
    }
    await h?.teardown();
  });

  test('a changed signature reaches the agent whose work imports it, with nothing having listed the lines of work', async () => {
    edit(billing, VALIDATORS, 'validateCreateUser(payload: CreateUserPayload)', 'validateCreateUser(payload: CreateUserPayload, strict: boolean)');
    let told = '';
    await expect.poll(async () => {
      const r = await caller.callTool('list_plans', {});
      expect(r.isError, r.text).toBeFalsy();
      told = r.text;
      return told.includes(NOTICE);
    }, { timeout: 20_000, intervals: [400] }).toBe(true);
    expect(told).toContain('high contract: `billing-v2` changed validateCreateUser');
  });
});
