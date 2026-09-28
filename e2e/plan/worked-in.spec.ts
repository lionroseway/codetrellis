/**
 * One plan, several worktrees, from the window (Phase 32 C5.1).
 *
 * 1. Sam opens the "Billing" section's Routing panel: "Worked in" says any
 *    worktree can pick its tasks up.
 * 2. Sam chooses the billing worktree: the note says only agents working
 *    there are offered or can claim its tasks, whichever agent they are.
 * 3. A task under it shows the choice as inherited from "Billing".
 *
 * The room of worktrees is given (CI's checkout has none of its own), and so
 * is the section endpoint, statefully; the backend's side of it, with real
 * worktrees and two agents, is `tests/e2e/section-worktrees.test.ts`.
 */

import fs from 'node:fs';
import path from 'node:path';
import { test, expect, type Page } from '@playwright/test';
import { gotoWithProject, openPlan, seedPlan, cleanupPlans, API, authHeaders } from '../helpers/setup';
import type { Workstream } from '../../src/shared/types';

const OUT = path.join('test-results', 'ux-audit');
const PLAN = 'E2E C5.1 worked-in plan';

const ws = (root: string, branch: string, main = false): Workstream => ({
  root, branch, head: '3f9c2e1a7b', main, shape: 'worktree', agents: [],
  changes: { base: null, files: [], truncated: false }, idle: true,
} as unknown as Workstream);
const ROOM = [ws('/work/acme', 'main', true), ws('/work/acme-billing', 'checkout-v2-billing'), ws('/work/acme-exports', 'exports')];

async function openRouting(page: Page, title: string) {
  await page.getByText(title, { exact: true }).first().click();
  const worked = page.getByTestId('worked-in');
  await expect(async () => {
    if (!(await worked.isVisible())) await page.getByRole('button', { name: /Routing & Execution/i }).click();
    await expect(worked).toBeVisible({ timeout: 1_000 });
  }).toPass({ timeout: 15_000 });
  return worked;
}

test.describe('Worked in: a section kept to one worktree', () => {
  test.afterEach(async ({ request }) => { await cleanupPlans(request, PLAN); });

  test('choose the section\'s worktree; its tasks show it as inherited', async ({ page, request }) => {
    const plan = await seedPlan(request, { title: PLAN, actions: [] });
    const post = async (body: Record<string, unknown>) =>
      ((await (await request.post(`${API}/plans/${plan.uid}/items`, { headers: authHeaders(), data: body })).json()) as { uid: string }).uid;
    const billing = await post({ kind: 'object', title: 'Billing' });
    await post({ kind: 'action', title: 'Partial refunds', parentUid: billing });

    // The section's branch, as the backend would hold it.
    let branch: string | null = null;
    const puts: unknown[] = [];
    await page.route('**/api/workstreams?*', (route) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(ROOM) }));
    await page.route((url) => /^\/api\/items\/[^/]+\/workstream$/.test(url.pathname), async (route) => {
      const uid = new URL(route.request().url()).pathname.split('/')[3];
      if (route.request().method() === 'PUT') {
        const body = route.request().postDataJSON() as { workstream: string | null };
        puts.push(body);
        branch = body.workstream;
      }
      const section = branch ? { branch, fromUid: billing, fromTitle: 'Billing' } : null;
      await route.fulfill({
        status: 200, contentType: 'application/json',
        body: JSON.stringify({ own: uid === billing ? branch : null, section, where: branch ? `${branch} in /work/acme-billing` : null }),
      });
    });

    await gotoWithProject(page);
    await openPlan(page, PLAN);

    const worked = await openRouting(page, 'Billing');
    const select = worked.getByTestId('worked-in-select');
    await expect(worked.getByTestId('worked-in-note')).toHaveText('Any agent, in any worktree, can pick these tasks up. Choose a worktree to keep this section to one.');
    // Every branch a workstream is on, main first, each with its folder.
    await expect(select.locator('option')).toHaveText(['Any worktree (default)', 'main — acme', 'checkout-v2-billing — acme-billing', 'exports — acme-exports']);

    await select.selectOption('checkout-v2-billing');
    await expect(worked.getByTestId('worked-in-note')).toHaveText('Only agents working on checkout-v2-billing in /work/acme-billing are offered these tasks or can claim them, whichever agent they are.');
    expect(puts).toEqual([{ workstream: 'checkout-v2-billing' }]);
    fs.mkdirSync(OUT, { recursive: true });
    await worked.screenshot({ path: path.join(OUT, 'worked-in-section.png') });

    // A task under it: inherited, and said so.
    const task = await openRouting(page, 'Partial refunds');
    await expect(task).toContainText('(inherited from “Billing”)');
    await expect(task.getByTestId('worked-in-select').locator('option').first()).toHaveText('As its section: checkout-v2-billing');
    await expect(task.getByTestId('worked-in-note')).toContainText('Only agents working on checkout-v2-billing in /work/acme-billing');
    await task.screenshot({ path: path.join(OUT, 'worked-in-task.png') });
  });

  test('C5.2: a new worktree for the section, named for it, then an agent started there', async ({ page, request }) => {
    const plan = await seedPlan(request, { title: PLAN, actions: [] });
    const billing = ((await (await request.post(`${API}/plans/${plan.uid}/items`, { headers: authHeaders(), data: { kind: 'object', title: 'Billing' } })).json()) as { uid: string }).uid;
    const projectRoot = process.cwd();
    const expectedBranch = 'e2e-c5-1-worked-in-plan-billing';
    const expectedFolder = `${projectRoot}-${expectedBranch}`;

    let branch: string | null = null;
    let made: string | null = null;
    const posts: Array<{ url: string; body: unknown }> = [];
    await page.route('**/api/workstreams?*', (route) => route.fulfill({
      status: 200, contentType: 'application/json',
      body: JSON.stringify(made ? [...ROOM, ws(made, branch!)] : ROOM),
    }));
    await page.route((url) => /^\/api\/items\/[^/]+\/(workstream|worktree)$/.test(url.pathname), async (route) => {
      const req = route.request();
      if (req.method() === 'POST') {
        const body = req.postDataJSON() as { branch: string };
        posts.push({ url: new URL(req.url()).pathname, body });
        branch = body.branch;
        made = expectedFolder;
        await route.fulfill({ status: 201, contentType: 'application/json', body: JSON.stringify({ branch, root: made, base: 'HEAD' }) });
        return;
      }
      const section = branch ? { branch, fromUid: billing, fromTitle: 'Billing' } : null;
      await route.fulfill({
        status: 200, contentType: 'application/json',
        body: JSON.stringify({ own: branch, section, where: branch ? `${branch} in ${made}` : null, root: made }),
      });
    });
    const terminals: unknown[] = [];
    await page.route('**/api/terminals', async (route) => {
      if (route.request().method() !== 'POST') return route.fallback();
      const body = route.request().postDataJSON() as { preset: string; cwd: string; title: string };
      terminals.push(body);
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ id: 'term-c52', preset: body.preset, cwd: body.cwd, title: body.title, alive: true, createdAt: Date.now() }) });
    });

    await gotoWithProject(page);
    await openPlan(page, PLAN);
    const worked = await openRouting(page, 'Billing');

    // Named for the plan and the section, editable, and the folder shown before anything is made.
    await worked.getByTestId('new-worktree').click();
    const form = worked.getByTestId('new-worktree-form');
    await expect(form.getByLabel('Branch for the new worktree')).toHaveValue(expectedBranch);
    await expect(form.getByTestId('new-worktree-folder')).toHaveText(`Makes ${expectedFolder} on a new branch, and keeps this section to it.`);
    fs.mkdirSync(OUT, { recursive: true });
    await worked.screenshot({ path: path.join(OUT, 'new-worktree-form.png') });
    await form.getByRole('button', { name: 'Make worktree' }).click();

    // Listed as a workstream at once, with its folder, not "no workstream here now".
    await expect(worked.getByTestId('worked-in-select').locator('option:checked')).toHaveText(`${expectedBranch} — ${expectedFolder.split('/').pop()}`);
    await expect(worked.getByTestId('worked-in-note')).toHaveText(`Only agents working on ${expectedBranch} in ${expectedFolder} are offered these tasks or can claim them, whichever agent they are.`);
    expect(posts).toEqual([{ url: `/api/items/${billing}/worktree`, body: { branch: expectedBranch } }]);

    // Start whichever agent the person uses, there.
    const start = worked.getByTestId('start-agent-here');
    await expect(start).toContainText(`Start an agent in ${expectedBranch}:`);
    await expect(start.getByRole('button')).toHaveText(['Claude Code', 'Codex', 'aider', 'A shell (any other agent)', 'Copy the folder']);
    await worked.screenshot({ path: path.join(OUT, 'new-worktree-start-agent.png') });
    await start.getByRole('button', { name: 'Codex' }).click();
    await expect.poll(() => terminals).toEqual([{ preset: 'codex', cwd: expectedFolder, title: `Codex · ${expectedBranch}` }]);
  });
});
