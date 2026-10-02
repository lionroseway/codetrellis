/**
 * One plan, several worktrees (Phase 32 C5.1), end to end, with two agents
 * of different clients and no hook: nothing here depends on Claude Code.
 *
 * "Checkout v2" has two sections. Sam gives Billing to the billing worktree
 * from the window; an agent gives Exports to the exports worktree over MCP.
 *  - Codex, in exports, asks for the next task: it gets Exports' or the
 *    plan's unassigned work, never Billing's, and is told one task was left
 *    out and where.
 *  - Codex tries to claim a Billing task: refused, told where it is worked.
 *  - Cursor, in billing, claims it.
 *  - The brief says where a task is worked, and whether that is yours.
 *  - A branch no workstream has, or a path, is refused over REST and MCP.
 */

import { test, expect } from '@playwright/test';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { setupHarness, createMcpClient, type Harness, type ScriptedMcp } from '../harness';

const ENV = { ...process.env, GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@x', GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@x' };

test.describe.serial('One plan, several worktrees', () => {
  test.setTimeout(120_000);

  let h: Harness;
  let root: string;
  let billingDir: string;
  let exportsDir: string;
  let codex: ScriptedMcp;
  let cursor: ScriptedMcp;
  let planUid: string;
  const uid: Record<string, string> = {};

  const raw = (method: string, url: string, body?: unknown) => h.client.raw(method, url, body);
  const json = async <T>(method: string, url: string, body?: unknown) => (await (await raw(method, url, body)).json()) as T;
  const add = async (key: string, kind: 'object' | 'action', title: string, parent?: string) => {
    uid[key] = (await json<{ uid: string }>('POST', `/api/plans/${planUid}/items`, { kind, title, ...(parent ? { parentUid: uid[parent] } : {}) })).uid;
  };
  const parsed = (text: string): Record<string, unknown> => { try { return JSON.parse(text); } catch { return {}; } };

  test.beforeAll(async () => {
    h = await setupHarness('section-worktrees');
    root = h.fixture.projectPath;
    billingDir = `${root}-billing`;
    exportsDir = `${root}-exports`;
    execFileSync('git', ['-C', root, 'worktree', 'add', '-q', billingDir, '-b', 'checkout-v2-billing'], { env: ENV });
    execFileSync('git', ['-C', root, 'worktree', 'add', '-q', exportsDir, '-b', 'exports'], { env: ENV });
    await h.client.scanProject(root);

    planUid = (await h.client.createPlan({ title: 'Checkout v2', projectPath: root })).uid;
    await add('billing', 'object', 'Billing');
    await add('refunds', 'action', 'Partial refunds', 'billing');
    await add('exports', 'object', 'Exports');
    await add('csv', 'action', 'CSV export', 'exports');
    await add('docs', 'action', 'Write the docs');

    codex = createMcpClient({ mcpPort: h.backend.mcpPort, capabilityToken: h.backend.capabilityToken, clientName: 'codex', roots: [exportsDir] });
    cursor = createMcpClient({ mcpPort: h.backend.mcpPort, capabilityToken: h.backend.capabilityToken, clientName: 'cursor', roots: [billingDir] });
    await codex.connect();
    await cursor.connect();
  });

  test.afterAll(async () => {
    await codex?.disconnect().catch(() => {});
    await cursor?.disconnect().catch(() => {});
    for (const w of [billingDir, exportsDir]) {
      try { execFileSync('git', ['-C', root, 'worktree', 'remove', '--force', w]); } catch { /* */ }
    }
    await h?.teardown();
  });

  test('Sam gives Billing to its worktree from the window; the section is inherited by its tasks', async () => {
    const res = await raw('PUT', `/api/items/${uid.billing}/workstream`, { workstream: 'checkout-v2-billing' });
    expect(res.status).toBe(200);
    const got = await raw('GET', `/api/items/${uid.refunds}/workstream`);
    expect(got.status).toBe(200);
    const view = (await got.json()) as { own: string | null; section: { branch: string; fromTitle: string } | null; where: string; root: string };
    expect(view.own).toBeNull();
    expect(view.section).toMatchObject({ branch: 'checkout-v2-billing', fromTitle: 'Billing' });
    expect(view.where).toBe(`checkout-v2-billing in ${billingDir}`);
    expect(path.resolve(view.root)).toBe(path.resolve(billingDir));
    // Recorded as Sam's edit, from how the call arrived.
    const item = await json<{ workstream: string | null }>('GET', `/api/items/${uid.billing}`);
    expect(item.workstream).toBe('checkout-v2-billing');
  });

  test('an agent gives Exports to the exports worktree over MCP; an unknown branch or a path is refused', async () => {
    const ok = await codex.callTool('assign_workstream', { item_uid: uid.exports, workstream: 'exports' });
    expect(ok.text).toContain(`“Exports” and everything under it are worked on exports in ${exportsDir}.`);
    const unknown = await codex.callTool('assign_workstream', { item_uid: uid.docs, workstream: 'nope' });
    expect(unknown.isError).toBe(true);
    expect(unknown.text).toMatch(/No workstream on a branch named "nope"\. Known: .*checkout-v2-billing/);
    for (const bad of ['nope', '../../etc', billingDir]) {
      expect((await raw('PUT', `/api/items/${uid.docs}/workstream`, { workstream: bad })).status).toBe(400);
    }
    expect((await json<{ workstream: string | null }>('GET', `/api/items/${uid.docs}`)).workstream).toBeNull();
  });

  test('Codex, in exports, is offered only its own section or unassigned work, and told what was left out', async () => {
    const next = await codex.callTool('get_next_item', { plan_uid: planUid });
    const offered = parsed(next.text);
    expect(['CSV export', 'Write the docs']).toContain(offered.title);
    expect(offered.elsewhere).toBe('Tasks in sections worked in other worktrees are not offered to you: 1 in checkout-v2-billing.');
    // Scoped to Billing, nothing is offered, and it says why.
    const scoped = await codex.callTool('get_next_item', { plan_uid: planUid, parent_uid: uid.billing });
    expect(scoped.text).toContain('No items available');
    expect(scoped.text).toContain('1 in checkout-v2-billing');
  });

  test('Codex cannot claim a Billing task and is told where it is worked; Cursor, in billing, can', async () => {
    const refused = parsed((await codex.callTool('claim_item', { uid: uid.refunds })).text);
    expect(refused).toMatchObject({ ok: false, reason: 'worked_elsewhere' });
    expect(refused.message).toBe(
      `“Partial refunds” is in “Billing”, which is worked on checkout-v2-billing in ${billingDir}. You are working on exports. `
      + 'Start a session there to claim it, or ask the person to move the section to your worktree.',
    );
    expect((await json<{ status: string; assignee: string | null }>('GET', `/api/items/${uid.refunds}`)).assignee).toBeNull();

    const claimed = parsed((await cursor.callTool('claim_item', { uid: uid.refunds })).text);
    expect(claimed.ok).toBe(true);
    expect((await json<{ assignee: string | null }>('GET', `/api/items/${uid.refunds}`)).assignee).not.toBeNull();
  });

  test('the brief says where a task is worked, and whether that is yours', async () => {
    const mine = parsed((await cursor.callTool('get_brief', { item_uid: uid.refunds })).text);
    expect(mine.worktree).toMatchObject({ branch: 'checkout-v2-billing', section: 'Billing', yours: true });
    const theirs = parsed((await codex.callTool('get_brief', { item_uid: uid.refunds })).text);
    expect(theirs.worktree).toMatchObject({ yours: false });
    expect((theirs.worktree as { note: string }).note).toContain('not in your worktree. Only an agent there can claim it.');
    // A task in no section says nothing about worktrees.
    expect(parsed((await codex.callTool('get_brief', { item_uid: uid.docs })).text).worktree).toBeUndefined();
  });

  test('cleared, the section is open to any worktree again', async () => {
    const cleared = await codex.callTool('assign_workstream', { item_uid: uid.exports, workstream: null });
    expect(cleared.text).toContain('“Exports” can be worked in any worktree.');
    expect((await raw('PUT', `/api/items/${uid.billing}/workstream`, { workstream: null })).status).toBe(200);
    expect((await json<{ section: unknown }>('GET', `/api/items/${uid.refunds}/workstream`)).section).toBeNull();
  });
});
