/**
 * The contract signal (Phase 32 A2.3), end to end: two worktrees of the
 * sample app, real edits on disk, the running backend's parser, the
 * project's import graph, and what a person (REST) and an agent (MCP) are
 * told.
 *
 * `billing-v2` changes a shared function's parameters; `checkout-fix` edits
 * a component that imports it through the shared package's barrel. That is
 * a high contract signal. Changing only the function's body is not, and
 * neither is a signature change nobody else's work imports.
 */

import { test, expect } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { setupHarness, createMcpClient, type Harness, type ScriptedMcp } from '../harness';

interface Signal {
  id: string; kind: string; severity: string; summary: string; workstreams: string[]; state: string;
  subject: { file?: string; symbol?: string; by?: string; change?: string; signature?: { before: string; after: string }; importers?: string[]; possibly?: boolean };
}

const VALIDATORS = 'packages/shared/src/validators.ts';
const USER_LIST = 'packages/web/src/UserList.tsx';
const ORDER_LIST = 'packages/web/src/OrderList.tsx';
const DB = 'services/api/app/db.py';
const ORDERS = 'services/api/app/routes/orders.py';
const ENV = { ...process.env, GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@x', GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@x' };

test.describe.serial('Contract signals', () => {
  test.setTimeout(120_000);

  let h: Harness;
  let root: string;
  let billing: string;
  let checkout: string;
  let agent: ScriptedMcp;

  const signals = async () => {
    const res = await h.client.raw('GET', `/api/awareness?project=${encodeURIComponent(root)}`);
    expect(res.status).toBe(200);
    return ((await res.json()) as { signals: Signal[] }).signals;
  };
  const contracts = async () => (await signals()).filter((s) => s.kind === 'contract');
  const same = (a: string, b: string) => fs.realpathSync(a) === fs.realpathSync(b);
  const edit = (folder: string, rel: string, from: string | RegExp, to: string) => {
    const f = path.join(folder, rel);
    const was = fs.readFileSync(f, 'utf-8');
    const now = was.replace(from, to);
    expect(now, `${rel} changed`).not.toBe(was);
    fs.writeFileSync(f, now);
  };
  const reset = (folder: string) => execFileSync('git', ['-C', folder, 'checkout', '-q', '--', '.'], { env: ENV });

  test.beforeAll(async () => {
    h = await setupHarness('awareness-contract', { env: { CODETRELLIS_WORKSTREAM_DEBOUNCE_MS: '150' } });
    root = h.fixture.projectPath;
    billing = `${root}-billing`;
    checkout = `${root}-checkout`;
    for (const [dir, branch] of [[billing, 'billing-v2'], [checkout, 'checkout-fix']]) {
      execFileSync('git', ['-C', root, 'worktree', 'add', '-q', dir, '-b', branch], { env: ENV });
    }
    await h.client.scanProject(root);
    agent = createMcpClient({ mcpPort: h.backend.mcpPort, capabilityToken: h.backend.capabilityToken, clientName: 'codex', roots: [checkout] });
    await agent.connect();
  });

  test.afterEach(() => { reset(billing); reset(checkout); });

  test.afterAll(async () => {
    await agent?.disconnect().catch(() => {});
    for (const w of [billing, checkout]) {
      try { execFileSync('git', ['-C', root, 'worktree', 'remove', '--force', w]); } catch { /* */ }
    }
    await h?.teardown();
  });

  test('a parameter change imported, through the barrel, by a file the other worktree edits is a high contract signal', async () => {
    edit(billing, VALIDATORS, 'validateCreateUser(payload: CreateUserPayload)', 'validateCreateUser(payload: CreateUserPayload, strict: boolean)');
    edit(checkout, USER_LIST, "import { validateCreateUser } from '@sample/shared';", "import { validateCreateUser } from '@sample/shared';\n// checkout-fix touches the form");

    const [c] = await contracts();
    expect(c).toBeTruthy();
    expect(c.severity).toBe('high');
    expect(c.subject).toMatchObject({
      file: VALIDATORS, symbol: 'validateCreateUser', change: 'signature',
      signature: { before: '(payload: CreateUserPayload): string[]', after: '(payload: CreateUserPayload, strict: boolean): string[]' },
      importers: [USER_LIST],
    });
    expect(same(c.subject.by!, billing)).toBe(true);
    expect(c.summary).toBe(
      `\`billing-v2\` changed validateCreateUser in ${VALIDATORS}: (payload: CreateUserPayload): string[] → (payload: CreateUserPayload, strict: boolean): string[]. \`checkout-fix\` imports it in 1 file`,
    );
    expect(c.workstreams.some((w) => same(w, checkout))).toBe(true);

    // The agent in the importing worktree is told by get_awareness.
    const told = JSON.parse((await agent.callTool('get_awareness', {})).answer) as { signals: Signal[]; digest: string };
    expect(told.signals.map((s) => `${s.severity} ${s.kind} ${s.subject.symbol}`)).toContain('high contract validateCreateUser');
    // The digest (A3.1): the same few lines the person reads, for the agent.
    expect(told.digest).toContain("`billing-v2` changed validateCreateUser's signature; `checkout-fix` imports it.");
    expect(told.digest).toContain('Waiting on the person: keep the old signature, or update the callers?');
  });

  test('changing only the body raises nothing, though the same importer is edited', async () => {
    edit(billing, VALIDATORS, "errors.push('name is required');", "errors.push('name is required (billing)');");
    edit(checkout, USER_LIST, "import { validateCreateUser } from '@sample/shared';", "import { validateCreateUser } from '@sample/shared';\n// still here");
    // Give the workstream watcher its debounce, then insist nothing came of it.
    await new Promise((r) => setTimeout(r, 600));
    expect(await contracts()).toEqual([]);
  });

  test('a signature change whose importers the other worktree leaves alone raises nothing', async () => {
    edit(billing, VALIDATORS, 'validateCreateUser(payload: CreateUserPayload)', 'validateCreateUser(payload: CreateUserPayload, strict: boolean)');
    edit(checkout, ORDER_LIST, "import { validateCreateOrder } from '@sample/shared';", "import { validateCreateOrder } from '@sample/shared';\n// orders only");
    await new Promise((r) => setTimeout(r, 600));
    expect(await contracts()).toEqual([]);
  });

  test('removing an export the other worktree\'s edited file imports is high too', async () => {
    edit(billing, VALIDATORS, /export function validateCreateOrder\([\s\S]*?\n}\n/, '');
    edit(checkout, ORDER_LIST, "import { validateCreateOrder } from '@sample/shared';", "import { validateCreateOrder } from '@sample/shared';\n// orders only");
    await expect.poll(async () => (await contracts()).map((c) => `${c.severity} ${c.subject.change} ${c.subject.symbol} ${c.subject.importers?.join(',')}`), { timeout: 10_000 })
      .toEqual([`high removed validateCreateOrder ${ORDER_LIST}`]);
  });

  test('Python: a parameter change to a module function its routes import', async () => {
    edit(billing, DB, 'def add_order(user_id: int, amount: float) -> Order:', 'def add_order(user_id: int, amount: float, currency: str) -> Order:');
    edit(checkout, ORDERS, 'from app.db import add_order, list_orders', 'from app.db import add_order, list_orders  # checkout-fix');
    await expect.poll(async () => (await contracts()).map((c) => `${c.severity} ${c.subject.file}#${c.subject.symbol} ${c.subject.importers?.join(',')}`), { timeout: 10_000 })
      .toEqual([`high ${DB}#add_order ${ORDERS}`]);
  });

  test('when the importing side reverts, the contract signal resolves on its own', async () => {
    edit(billing, VALIDATORS, 'validateCreateUser(payload: CreateUserPayload)', 'validateCreateUser(payload: CreateUserPayload, strict: boolean)');
    edit(checkout, USER_LIST, "import { validateCreateUser } from '@sample/shared';", "import { validateCreateUser } from '@sample/shared';\n// touch");
    await expect.poll(async () => (await contracts()).length, { timeout: 10_000 }).toBe(1);
    reset(checkout);
    await expect.poll(async () => (await contracts()).length, { timeout: 10_000 }).toBe(0);
  });
});
