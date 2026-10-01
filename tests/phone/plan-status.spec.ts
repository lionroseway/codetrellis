/**
 * A plan's status, on the phone (Phase 32 C2.4).
 *
 * Dana opens the Q3 board pack from her phone. The status card says how far
 * it has got, what is waiting on someone and what is under way, each line
 * saying where it came from: "from the plan" for the analyst's report, which
 * has no branch, and "from git" for the code task beside it, in the same
 * type. The lineage runs from the ticket to the plan to where the work is.
 *
 * The desktop's side (`plan.status`) is served here as the RPC answer;
 * tests/e2e/plan-status.test.ts checks it against a real backend and a
 * paired phone.
 */
import { test, expect } from '@playwright/test';
import { openScreen, shot } from './helpers';

const line = (itemUid: string, title: string, words: string, source: string) => ({
  itemUid, title, words, source, from: source === 'plan' ? 'from the plan' : source === 'git' ? 'from git' : `from ${source}`,
});

const PLAN = {
  plan: { uid: 'p1', title: 'Q3 board pack', status: 'in_progress', description: null, projectPath: '/work/finance', createdAt: 1, updatedAt: 2 },
  items: [], deviations: [], phases: [], documents: [], externalRefs: [], comments: [],
};

const STATUS = {
  planUid: 'p1', title: 'Q3 board pack', base: 'main',
  progress: { done: 2, total: 5, words: '2 of 5 tasks done' },
  waiting: [line('i3', 'Sign off the figures', 'in progress; 0 of 1 criteria met, 1 waiting for sign-off', 'plan')],
  inProgress: [
    line('i1', 'Write the board report', 'in progress, 60%', 'plan'),
    line('i2', 'Export the revenue chart', 'pushed, not merged', 'git'),
  ],
  lineage: ['FIN-88 → this plan → board-charts pushed'],
  updatedAt: Date.UTC(2026, 8, 26, 14, 2),
  items: [],
};

test('the plan\'s status: progress, waiting, under way and lineage, each line with its source', async ({ page }) => {
  await openScreen(page, 'plan-detail', {
    rpc: { 'plan.get': PLAN, 'plan.status': STATUS, 'budget.get': { __error: 'none' }, 'freeze.get': { __error: 'none' } },
  }, { uid: 'p1' });
  const card = page.getByTestId('plan-status');
  await expect(card).toBeVisible();
  await expect(card.getByTestId('plan-status-progress')).toHaveText('2 of 5 tasks done');
  const lines = card.getByTestId('plan-status-line');
  await expect(lines).toHaveCount(3);
  await expect(lines.nth(0)).toContainText('Sign off the figures');
  await expect(lines.nth(0)).toContainText('from the plan');
  await expect(lines.nth(1)).toContainText('Write the board report — in progress, 60%');
  await expect(lines.nth(1)).toContainText('from the plan');
  await expect(lines.nth(2)).toContainText('from git');
  await expect(card.getByTestId('plan-status-lineage')).toHaveText('FIN-88 → this plan → board-charts pushed');
  await card.scrollIntoViewIfNeeded();
  await shot(page, 'plan-status');
});

test('a desktop without plan.status: the plan shows, without the card', async ({ page }) => {
  await openScreen(page, 'plan-detail', {
    rpc: { 'plan.get': PLAN, 'budget.get': { __error: 'none' }, 'freeze.get': { __error: 'none' } },
  }, { uid: 'p1' });
  await expect(page.getByText('Q3 board pack').first()).toBeVisible();
  await expect(page.getByTestId('plan-status')).toHaveCount(0);
});
