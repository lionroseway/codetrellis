/**
 * "Work this section in a new worktree" (Phase 32 C5.2), end to end.
 *
 * Sam has "Checkout v2" with a Billing section and no worktrees. From the
 * window, Billing gets a new worktree: git makes it beside the project on a
 * new branch named after the plan and the section, and the section is
 * assigned to it. An agent started there, whatever its client, is offered
 * and can claim Billing's task.
 *
 * What exists is never reused (a folder, a branch), a bad name is refused,
 * and over plain HTTP, where it is not the person's window, nothing is made.
 */

import { test, expect } from '@playwright/test';
import fs from 'node:fs';
import { execFileSync } from 'node:child_process';
import { setupHarness, createMcpClient, type Harness } from '../harness';

const git = (cwd: string, ...args: string[]) => execFileSync('git', ['-C', cwd, ...args], { encoding: 'utf-8' }).trim();

test.describe.serial('A new worktree for a section', () => {
  test.setTimeout(120_000);

  let h: Harness;
  let root: string;
  let planUid: string;
  let billing: string;
  let refunds: string;
  let exportsUid: string;
  const made: string[] = [];

  const raw = (method: string, url: string, body?: unknown) => h.client.raw(method, url, body);
  const json = async <T>(method: string, url: string, body?: unknown) => (await (await raw(method, url, body)).json()) as T;

  test.beforeAll(async () => {
    h = await setupHarness('section-new-worktree');
    root = h.fixture.projectPath;
    await h.client.scanProject(root);
    planUid = (await h.client.createPlan({ title: 'Checkout v2', projectPath: root })).uid;
    billing = (await json<{ uid: string }>('POST', `/api/plans/${planUid}/items`, { kind: 'object', title: 'Billing' })).uid;
    refunds = (await json<{ uid: string }>('POST', `/api/plans/${planUid}/items`, { kind: 'action', title: 'Partial refunds', parentUid: billing })).uid;
    exportsUid = (await json<{ uid: string }>('POST', `/api/plans/${planUid}/items`, { kind: 'object', title: 'Exports' })).uid;
  });

  test.afterAll(async () => {
    for (const dir of made) {
      try { execFileSync('git', ['-C', root, 'worktree', 'remove', '--force', dir]); } catch { /* */ }
    }
    await h?.teardown();
  });

  test('Billing gets a new worktree: a new branch beside the project, and the section assigned to it', async () => {
    const res = await raw('POST', `/api/items/${billing}/worktree`, {});
    expect(res.status).toBe(201);
    const made1 = (await res.json()) as { branch: string; root: string; base: string };
    made.push(made1.root);
    expect(made1).toEqual({ branch: 'checkout-v2-billing', root: `${root}-checkout-v2-billing`, base: 'HEAD' });
    // git made it, on that branch, as a worktree of this repository.
    expect(fs.existsSync(made1.root)).toBe(true);
    expect(git(made1.root, 'rev-parse', '--abbrev-ref', 'HEAD')).toBe('checkout-v2-billing');
    expect(git(root, 'worktree', 'list', '--porcelain')).toContain(`worktree ${made1.root}`);
    // The section is assigned, and CodeTrellis knows the worktree.
    const view = await json<{ own: string; where: string }>('GET', `/api/items/${billing}/workstream`);
    expect(view.own).toBe('checkout-v2-billing');
    expect(view.where).toBe(`checkout-v2-billing in ${made1.root}`);
  });

  test('an agent started there is offered and claims Billing\'s task', async () => {
    const agent = createMcpClient({ mcpPort: h.backend.mcpPort, capabilityToken: h.backend.capabilityToken, clientName: 'aider', roots: [`${root}-checkout-v2-billing`] });
    await agent.connect();
    try {
      // Called straight after connecting: the agent's folder is placed before the call runs.
      const next = JSON.parse((await agent.callTool('get_next_item', { plan_uid: planUid, parent_uid: billing })).text) as { uid: string };
      expect(next.uid).toBe(refunds);
      const claimed = JSON.parse((await agent.callTool('claim_item', { uid: refunds })).text) as { ok: boolean };
      expect(claimed.ok).toBe(true);
    } finally {
      await agent.disconnect().catch(() => {});
    }
  });

  test('a name given is used; what exists is never reused; a bad name is refused', async () => {
    const named = await raw('POST', `/api/items/${exportsUid}/worktree`, { branch: 'exports/csv' });
    expect(named.status).toBe(201);
    const body = (await named.json()) as { branch: string; root: string };
    made.push(body.root);
    expect(body).toMatchObject({ branch: 'exports/csv', root: `${root}-exports-csv` });

    // The same again: the folder exists.
    const again = await raw('POST', `/api/items/${exportsUid}/worktree`, { branch: 'exports/csv' });
    expect(again.status).toBe(409);
    expect(((await again.json()) as { error: string }).error).toContain('already exists');
    // An existing branch with no folder: still not reused.
    git(root, 'branch', 'taken');
    const taken = await raw('POST', `/api/items/${exportsUid}/worktree`, { branch: 'taken' });
    expect(taken.status).toBe(409);
    expect(((await taken.json()) as { error: string }).error).toBe('A branch named taken already exists; choose another name');
    for (const bad of ['--upload-pack=x', '../escape', 'a b']) {
      expect((await raw('POST', `/api/items/${exportsUid}/worktree`, { branch: bad })).status).toBe(400);
    }
    expect(fs.existsSync(`${root}-taken`)).toBe(false);
  });
});

test.describe.serial('A new worktree, over plain HTTP', () => {
  test.setTimeout(90_000);
  let h: Harness;

  test.beforeAll(async () => {
    h = await setupHarness('section-new-worktree-http', { env: { CODETRELLIS_ALLOW_HTTP_GRANTS: '0' } });
    await h.client.scanProject(h.fixture.projectPath);
  });
  test.afterAll(async () => { await h?.teardown(); });

  test('is refused with where to do it, and nothing is made', async () => {
    const planUid = (await h.client.createPlan({ title: 'Checkout v2', projectPath: h.fixture.projectPath })).uid;
    const section = ((await (await h.client.raw('POST', `/api/plans/${planUid}/items`, { kind: 'object', title: 'Billing' })).json()) as { uid: string }).uid;
    const res = await h.client.raw('POST', `/api/items/${section}/worktree`, {});
    expect(res.status).toBe(403);
    expect(((await res.json()) as { error: string }).error).toBe('Making a worktree creates a folder on your machine, so it is done from the CodeTrellis window.');
    expect(fs.existsSync(`${h.fixture.projectPath}-checkout-v2-billing`)).toBe(false);
  });
});
