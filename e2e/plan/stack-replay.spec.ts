/**
 * Phase 32 B6.5 — one clock: the stack at a past moment (JOURNEYS H1, G1).
 *
 * Sam replays the last hour. On the Stack tab, each moment shows the plans
 * under way then: at the first, Billing alone with nobody on its task; at
 * the next, Exports too, its task waiting on Billing's while Codex worked
 * it, the two plans meeting on a file; at the last, the wait met. "Back to
 * live" brings today's stack back.
 *
 * The moments are served (the stack at a moment is harness-tested against a
 * real backend in tests/e2e/stack-at.test.ts), so the screen is tested on a
 * known hour rather than on whatever this repository's agents did.
 */

import fs from 'node:fs';
import path from 'node:path';
import { test, expect, type Page } from '@playwright/test';
import { gotoWithProject } from '../helpers/setup';
import type { Stack, StackPlan, StackTask } from '../../src/shared/types/stack';

const OUT = path.join('test-results', 'ux-audit');
const MIN = 60_000;
const now = Date.now();

const frame = (id: number, at: number, reasons: string[]) => ({
  id, at, reasons, ref: null, sessionId: null, agentType: null, workstreamRoot: null,
  commitSha: null, branch: 'main', sameAs: null, fileCount: 3, edgeCount: 2,
});
const FRAMES = [frame(21, now - 50 * MIN, ['status']), frame(22, now - 30 * MIN, ['status']), frame(23, now - 10 * MIN, ['status'])];

const task = (over: Partial<StackTask> & Pick<StackTask, 'uid' | 'title'>): StackTask => ({
  parentUid: null, kind: 'action', status: 'pending', assignee: null, assigneeType: null, assigneeSession: null,
  workstream: null, ticketKey: null, files: [], dependencies: [], waits: null, ...over,
});
const plan = (over: Partial<StackPlan> & Pick<StackPlan, 'uid' | 'title' | 'tasks'>): StackPlan => ({
  status: 'in_progress', ticketKey: null, label: over.title, progress: { done: 0, total: over.tasks.length }, needsYou: 0, overlaps: [], ...over,
});

const MIGRATE = { uid: 'i-migrate', title: 'Migrate schema' };
const DEPLOY = { uid: 'i-deploy', title: 'Deploy exports' };

const STACKS: Stack[] = [
  { project: '/work/acme', plans: [plan({ uid: 'p-billing', title: 'Billing v2', tasks: [task(MIGRATE)] })] },
  {
    project: '/work/acme',
    plans: [
      plan({
        uid: 'p-billing', title: 'Billing v2',
        tasks: [task({ ...MIGRATE, status: 'in_progress', assignee: 'codex', workstream: 'billing-v2' })],
        overlaps: [{ withPlanUid: 'p-exports', withLabel: 'Exports', declared: { files: ['src/billing/charge.ts'], symbols: [] }, actual: [], high: false, words: '⚠ overlaps Exports', detail: 'Both plan to change src/billing/charge.ts.' }],
      }),
      plan({
        uid: 'p-exports', title: 'Exports',
        tasks: [task({
          ...DEPLOY, workstream: 'exports-v1',
          dependencies: [{ uid: MIGRATE.uid, met: false, problem: 'unfinished', title: MIGRATE.title, planUid: 'p-billing', planTitle: 'Billing v2', words: '“Migrate schema” in plan “Billing v2”' }],
          waits: '“Deploy exports” waits on “Migrate schema” in plan “Billing v2”.',
        })],
        overlaps: [{ withPlanUid: 'p-billing', withLabel: 'Billing v2', declared: { files: ['src/billing/charge.ts'], symbols: [] }, actual: [], high: false, words: '⚠ overlaps Billing v2', detail: 'Both plan to change src/billing/charge.ts.' }],
      }),
    ],
  },
  {
    project: '/work/acme',
    plans: [
      plan({ uid: 'p-billing', title: 'Billing v2', progress: { done: 1, total: 1 }, tasks: [task({ ...MIGRATE, status: 'done', assignee: 'codex', workstream: 'billing-v2' })] }),
      plan({
        uid: 'p-exports', title: 'Exports',
        tasks: [task({ ...DEPLOY, workstream: 'exports-v2', dependencies: [{ uid: MIGRATE.uid, met: true, problem: null, title: MIGRATE.title, planUid: 'p-billing', planTitle: 'Billing v2', words: null }] })],
      }),
    ],
  },
];

const LIVE: Stack = { project: '/work/acme', plans: [plan({ uid: 'p-live', title: 'Today’s plan', tasks: [task({ uid: 'i-live', title: 'Ship it' })] })] };

function stateAt(at: number) {
  const i = Math.max(0, FRAMES.map((f) => f.at <= at).lastIndexOf(true));
  return { at, projectPath: '/work/acme', frame: FRAMES[i], sinceFrame: null, tasks: [], signals: [], waiting: [], stack: STACKS[i] };
}

async function serve(page: Page) {
  const json = (body: unknown) => ({ status: 200, contentType: 'application/json', body: JSON.stringify(body) });
  await page.route('**/api/stack?*', (r) => r.fulfill(json(LIVE)));
  await page.route('**/api/replay/frames?*', (r) => r.fulfill(json({ frames: FRAMES })));
  await page.route('**/api/replay/state?*', (r) => r.fulfill(json(stateAt(Number(new URL(r.request().url()).searchParams.get('at'))))));
  await page.route(/\/api\/trellis\/2[123]$/, (r) => r.fulfill(json({ id: 21, data: { files: [{ path: 'src/billing/charge.ts' }], edges: [] } })));
}

async function shot(page: Page, name: string) {
  fs.mkdirSync(OUT, { recursive: true });
  await page.waitForTimeout(300);
  await page.screenshot({ path: path.join(OUT, `${name}.png`) });
}

test('replaying, the Stack tab shows the plans under way at each moment, as they were; Back to live brings today back', async ({ page }) => {
  await serve(page);
  await gotoWithProject(page);

  await page.getByRole('button', { name: 'Stack', exact: true }).first().click();
  const row = (uid: string) => page.locator(`[data-testid="stack-plan"][data-plan-uid="${uid}"]`);
  await expect(row('p-live')).toBeVisible({ timeout: 10_000 });

  // Into replay from the Timeline, then back to the Stack tab: the first moment.
  await page.getByRole('button', { name: /^Timeline( \d+)?$/ }).first().click();
  await page.getByTestId('replay-start').click();
  const bar = page.getByTestId('replay-bar');
  await expect(bar).toBeVisible();
  await page.getByRole('button', { name: 'Stack', exact: true }).first().click();

  const then = page.getByTestId('stack-then');
  await expect(then).toHaveText(/^The stack at \d\d:\d\d, as it was then\. Links open the plan as it is now\.$/);
  await expect(page.getByTestId('stack-tab')).toContainText('1 plan was under way');
  await expect(row('p-billing')).toBeVisible();
  await expect(row('p-exports')).toHaveCount(0);
  await expect(row('p-live')).toHaveCount(0);
  await expect(row('p-billing').getByTestId('stack-assignee')).toHaveCount(0);

  // The next moment: Exports too, waiting on Billing's task while Codex worked it.
  await bar.getByTitle('Next frame').click();
  await expect(row('p-exports')).toBeVisible();
  await expect(row('p-billing').getByTestId('stack-assignee')).toHaveText('codex');
  await expect(row('p-exports').getByTestId('stack-dependency')).toHaveText('↑ waits on “Migrate schema” in plan “Billing v2”');
  await expect(row('p-exports').getByTestId('stack-workstream')).toHaveText('⎇ exports-v1');
  await expect(row('p-exports').locator('[data-testid="stack-overlap"][data-with-plan-uid="p-billing"]')).toHaveText('⚠ overlaps Billing v2');
  await expect(page.getByTestId('replay-canvas')).toContainText('1 file · replaying');
  // Room for the replay bar and the rows under it, as a person would make it.
  const panel = page.getByTestId('stack-tab').locator('xpath=ancestor::div[.//button[@title="Expand panel"]][1]');
  await panel.getByTitle('Expand panel').click();
  await shot(page, 'stack-replay');
  await panel.getByTitle('Collapse panel').click();

  // The last moment: the wait met, the section moved to another branch.
  await bar.getByTitle('Next frame').click();
  await expect(row('p-exports').getByTestId('stack-dependency')).toHaveCount(0);
  await expect(row('p-exports').getByTestId('stack-dependency-met')).toHaveText('✓ after “Migrate schema” in Billing v2');
  await expect(row('p-exports').getByTestId('stack-workstream')).toHaveText('⎇ exports-v2');

  // Back to live: today's stack, and no "as it was" line.
  await page.getByTestId('replay-live').click();
  await expect(then).toHaveCount(0);
  await expect(row('p-live')).toBeVisible();
  await expect(row('p-billing')).toHaveCount(0);
});
