/**
 * Phase 33 V6 — did the change do what the task said.
 *
 * Only when a change is linked to a task: a plan item naming its branch.
 * Branch `payments` is: an item planned the checkout page and the cart, and
 * carries two criteria. The change touches the page, not the cart, and also
 * the API's requirements, which nobody planned. Its review says each, with
 * every criterion and where it stands. Branch `docs-tidy` has no task: its
 * review has no task section at all.
 */

import { test, expect } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { setupHarness, type Harness, type ScriptedAgent } from '../harness';

const PAGE = 'packages/web/src/Checkout.ts';
const CART = 'packages/web/src/Cart.ts';
const REQS = 'services/api/requirements.txt';
const ENV = { ...process.env, GIT_AUTHOR_NAME: 'Sam', GIT_AUTHOR_EMAIL: 'sam@acme.test', GIT_COMMITTER_NAME: 'Sam', GIT_COMMITTER_EMAIL: 'sam@acme.test' };

interface Task {
  branch: string;
  items: Array<{ title: string; verdict: string; landed: string[]; missing: string[]; criteria: Array<{ text: string; state: string }> }>;
  unplanned: string[];
  words: string[];
}

test.describe.serial('V6: did the change do what the task said', () => {
  test.setTimeout(180_000);
  let h: Harness;
  let root: string;
  let agent: ScriptedAgent;
  let main: string;
  const git = (...args: string[]) => execFileSync('git', ['-C', root, ...args], { encoding: 'utf-8', env: ENV }).trim();
  const post = async (url: string, body: unknown) => (await h.client.raw('POST', url, body)).json() as Promise<{ uid: string }>;

  test.beforeAll(async () => {
    h = await setupHarness('review-task');
    root = h.fixture.projectPath;
    main = git('rev-parse', '--abbrev-ref', 'HEAD');

    git('checkout', '-qb', 'payments');
    fs.writeFileSync(path.join(root, PAGE), "export const pay = (cents: number) => fetch('/api/charges', { method: 'POST', body: String(cents) });\n");
    fs.appendFileSync(path.join(root, REQS), 'stripe>=8\n');
    git('add', '-A');
    git('commit', '-qm', 'Checkout');
    git('checkout', '-q', main);

    git('checkout', '-qb', 'docs-tidy');
    fs.appendFileSync(path.join(root, 'README.md'), '\nMore words.\n');
    git('commit', '-qam', 'Docs');
    git('checkout', '-q', main);
    await h.client.scanProject(root);

    const plan = await h.client.createPlan({ title: 'Q4 checkout', projectPath: root });
    const item = await post(`/api/plans/${plan.uid}/items`, {
      kind: 'action', title: 'Checkout page',
      fileSpecs: [{ path: PAGE, action: 'create' }, { path: CART, action: 'modify' }],
    });
    expect((await h.client.raw('PUT', `/api/items/${item.uid}/workstream`, { workstream: 'payments' })).ok).toBe(true);
    for (const text of ['A card payment goes through', 'The cart shows the total']) {
      expect((await h.client.raw('POST', `/api/items/${item.uid}/criteria`, { text, kind: 'manual' })).status).toBe(201);
    }
    agent = await h.spawnAgent({ agentType: 'claude-code' });
  });

  test.afterAll(async () => { await h?.teardown(); });

  test('a linked change: planned against touched, the unplanned file, and each criterion', async () => {
    const r = await agent.callTool('review_change', { base: main, head: 'payments', project_path: root });
    expect(r.isError, r.text).toBeFalsy();
    const task = (JSON.parse(r.answer) as { task?: Task }).task!;
    expect(task.branch).toBe('payments');
    expect(task.items).toHaveLength(1);
    const [i] = task.items;
    expect(i.verdict).toBe('partial');
    expect(i.landed).toEqual([PAGE]);
    expect(i.missing).toEqual([CART]);
    expect(i.criteria).toEqual([
      { text: 'A card payment goes through', state: 'open' },
      { text: 'The cart shows the total', state: 'open' },
    ]);
    expect(task.unplanned).toEqual([REQS]);
    expect(task.words).toEqual([
      `◐ Checkout page: touched 1 of the 2 files it planned; not ${CART}; 0 of 2 criteria met.`,
      `Changed 1 file the task did not plan: ${REQS}.`,
    ]);

    const md = (await agent.callTool('review_change', { base: main, head: 'payments', project_path: root, format: 'markdown' })).answer;
    const lines = md.split('\n');
    expect(lines.indexOf('### Did it do what the task said')).toBeGreaterThan(lines.indexOf('### What this change does to the architecture'));
    expect(md).toContain('- ○ The cart shows the total (open)');
  });

  test('the same over REST', async () => {
    const q = `project=${encodeURIComponent(root)}`;
    const body = (await (await h.client.raw('GET', `/api/review/architecture?${q}&base=${main}&head=payments`)).json()) as { task?: Task };
    expect(body.task?.unplanned).toEqual([REQS]);
    const md = await (await h.client.raw('GET', `/api/review/architecture?${q}&base=${main}&head=payments&format=markdown`)).text();
    expect(md).toContain('### Did it do what the task said');
  });

  test('an unlinked change has no task section: absent, not empty', async () => {
    const r = await agent.callTool('review_change', { base: main, head: 'docs-tidy', project_path: root });
    expect('task' in (JSON.parse(r.answer) as object)).toBe(false);
    const md = (await agent.callTool('review_change', { base: main, head: 'docs-tidy', project_path: root, format: 'markdown' })).answer;
    expect(md).not.toContain('Did it do what the task said');
  });
});
