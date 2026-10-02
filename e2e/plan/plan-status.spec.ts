/**
 * The plan's status, from the window (Phase 32 C2.4).
 *
 * Dana opens "Q3 board pack". The header says "2 of 5 tasks done"; opened,
 * it is the plan's status view: the figures waiting on her sign-off, the
 * report and the chart under way, and the lineage from FIN-88 to the plan to
 * the chart's branch. Each line says where it came from: "from the plan"
 * for the report, which has no branch, "from git" for the chart, in the same
 * type. Every row in the tree says its state and source on hover, and the
 * report's page says it under its title, with who recorded it.
 *
 * The answer is given (the backend's side, with get_plan and the phone, is
 * tests/e2e/plan-status.test.ts).
 */

import fs from 'node:fs';
import path from 'node:path';
import { test, expect } from '@playwright/test';
import { gotoWithProject, openPlan, seedPlan, cleanupPlans } from '../helpers/setup';

const OUT = path.join('test-results', 'ux-audit');
const PLAN = 'E2E C2.4 Q3 board pack';
const SEP26 = Date.UTC(2026, 8, 26, 14, 2);

test.describe('The plan\'s status', () => {
  test.afterEach(async ({ request }) => { await cleanupPlans(request, PLAN); });

  test('the header opens the status view; every line, row and page says its state and where it came from', async ({ page, request }) => {
    const plan = await seedPlan(request, { title: PLAN, actions: [] });
    const at = Date.now();
    const item = (uid: string, parentUid: string | null, kind: 'object' | 'action', title: string, sortOrder: number, extra: Record<string, unknown> = {}) => ({
      uid, planUid: plan.uid, parentUid, sortOrder, kind, title, body: '', template: null,
      status: kind === 'action' ? 'pending' : null, assignee: null, assigneeType: null, assigneeModel: null,
      progressPercent: null, blockedReason: null, scopePath: null, fileSpecs: [], symbolSpecs: [], newConnections: [],
      removedConnections: [], dependencies: [], skills: [], skillsMode: 'inherit', claimPolicy: null, claimPolicyMode: 'inherit',
      executionConfig: null, executionConfigMode: 'inherit', constraints: null, constraintsMode: 'inherit', requiresApproval: false,
      author: 'Dana', authorType: 'human', createdAt: at, updatedAt: at, migratedFrom: null, visibility: 'shared',
      overrideParentVisibility: false, assigneeSession: null, workstream: null, ...extra,
    });
    const ITEMS = [
      item('c24-report', null, 'object', 'Report', 0),
      item('c24-write', 'c24-report', 'action', 'Write the board report', 0, { status: 'in_progress', progressPercent: 60 }),
      item('c24-check', 'c24-report', 'action', 'Check the figures', 1, { status: 'done' }),
      item('c24-sign', 'c24-report', 'action', 'Sign off the figures', 2, { status: 'in_progress' }),
      item('c24-charts', null, 'object', 'Charts', 1, { workstream: 'board-charts' }),
      item('c24-chart', 'c24-charts', 'action', 'Export the revenue chart', 0),
      item('c24-deck', null, 'action', 'Assemble the deck', 2),
    ];
    const dana = { by: 'Dana', byType: 'human', at: SEP26 };
    const git = { state: 'pushed', source: 'git', branch: 'board-charts', base: 'main', commit: '3f9c2e1a7b3f9c2e1a7b3f9c2e1a7b3f9c2e1a7b', at: 1_790_000_000, words: 'pushed, not merged' };
    const s = (itemUid: string, title: string, kind: string, state: string, source: string, words: string, extra: Record<string, unknown> = {}) => ({
      itemUid, title, kind, state, source, words, from: source === 'plan' ? 'from the plan' : 'from git', recorded: null, branch: null, ...extra,
    });
    const STATUS = {
      planUid: plan.uid, title: PLAN, base: 'main',
      items: [
        s('c24-report', 'Report', 'object', 'in-progress', 'plan', '1 of 3 tasks done'),
        s('c24-write', 'Write the board report', 'action', 'in-progress', 'plan', 'in progress, 60%', { recorded: dana }),
        s('c24-check', 'Check the figures', 'action', 'done', 'plan', 'done, signed off by Priya', { recorded: dana }),
        s('c24-sign', 'Sign off the figures', 'action', 'in-progress', 'plan', 'in progress; 0 of 1 criteria met, 1 waiting for sign-off', { recorded: dana }),
        s('c24-charts', 'Charts', 'object', 'pushed', 'git', 'pushed, not merged', { branch: 'board-charts', git: { ...git, itemUid: 'c24-charts', fromUid: 'c24-charts' } }),
        s('c24-chart', 'Export the revenue chart', 'action', 'pushed', 'git', 'pushed, not merged', { branch: 'board-charts', git: { ...git, itemUid: 'c24-chart', fromUid: 'c24-charts' } }),
        s('c24-deck', 'Assemble the deck', 'action', 'not-started', 'plan', 'not started'),
      ],
      progress: { done: 2, total: 5, words: '2 of 5 tasks done' },
      waiting: [{ itemUid: 'c24-sign', title: 'Sign off the figures', words: 'in progress; 0 of 1 criteria met, 1 waiting for sign-off', source: 'plan', from: 'from the plan' }],
      inProgress: [
        { itemUid: 'c24-write', title: 'Write the board report', words: 'in progress, 60%', source: 'plan', from: 'from the plan' },
        { itemUid: 'c24-chart', title: 'Export the revenue chart', words: 'pushed, not merged', source: 'git', from: 'from git' },
      ],
      lineage: ['FIN-88 → this plan → board-charts pushed'],
      updatedAt: SEP26,
    };
    let asked = 0;
    await page.route(`**/api/plans/${plan.uid}/items`, (route) => (route.request().method() === 'GET'
      ? route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(ITEMS) })
      : route.fallback()));
    await page.route(`**/api/plans/${plan.uid}/status`, (route) => { asked++; return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(STATUS) }); });

    await gotoWithProject(page);
    await openPlan(page, PLAN);

    // The header: how far it has got, counted from the plan and git together.
    const chip = page.getByTestId('plan-status-chip');
    await expect(chip.getByTestId('plan-status-progress')).toHaveText('2 of 5 tasks done');
    expect(asked).toBeGreaterThan(0);

    // Opened: the plan's status view, each line with its source.
    await chip.click();
    const view = page.getByTestId('plan-status-view');
    await expect(view).toBeVisible();
    const waiting = view.getByTestId('plan-status-waiting').getByTestId('plan-status-line');
    await expect(waiting).toHaveCount(1);
    await expect(waiting.first()).toContainText('Sign off the figures — in progress; 0 of 1 criteria met, 1 waiting for sign-off');
    await expect(waiting.first().getByTestId('plan-status-source')).toHaveText('from the plan');
    const going = view.getByTestId('plan-status-in-progress').getByTestId('plan-status-line');
    await expect(going).toHaveCount(2);
    await expect(going.nth(0).getByTestId('plan-status-source')).toHaveText('from the plan');
    await expect(going.nth(1)).toContainText('Export the revenue chart — pushed, not merged');
    await expect(going.nth(1).getByTestId('plan-status-source')).toHaveText('from git');
    await expect(view.getByTestId('plan-status-lineage')).toContainText('FIN-88 → this plan → board-charts pushed');
    await expect(view).toContainText('No status file is kept.');
    fs.mkdirSync(OUT, { recursive: true });
    await view.screenshot({ path: path.join(OUT, 'plan-status-view.png') });
    // Escape closes the view, and only the view: the plan stays open.
    await page.keyboard.press('Escape');
    await expect(view).toHaveCount(0);
    await expect(chip).toBeVisible();

    // The tree: every row says its state and source on hover.
    const tree = page.getByTestId('plan-item-tree');
    const row = (title: string) => tree.locator('[data-state-source]').filter({ hasText: title }).first();
    await expect(row('Write the board report')).toHaveAttribute('title', 'in progress, 60% — from the plan, recorded by Dana, 26 Sept');
    await expect(row('Write the board report')).toHaveAttribute('data-state-source', 'plan');
    await expect(row('Export the revenue chart')).toHaveAttribute('title', 'pushed, not merged — from git');
    await expect(row('Assemble the deck')).toHaveAttribute('data-state', 'not-started');
    await expect(tree.locator('[data-state-source]')).toHaveCount(ITEMS.length);

    // The report's page: its state under the title, from the plan, with who recorded it.
    await page.getByText('Write the board report', { exact: true }).first().click();
    const line = page.getByTestId('item-state-line');
    await expect(line).toHaveAttribute('data-source', 'plan');
    await expect(line.getByTestId('item-state-words')).toHaveText('in progress, 60%');
    await expect(line.getByTestId('item-state-source')).toHaveText('from the plan');
    await expect(line.getByTestId('item-state-recorded')).toHaveText('recorded by Dana, 26 Sept');
    await line.locator('..').screenshot({ path: path.join(OUT, 'item-state-line.png') });

    // The chart's page: from git, with no "recorded by".
    await page.getByText('Export the revenue chart', { exact: true }).first().click();
    await expect(line).toHaveAttribute('data-source', 'git');
    await expect(line.getByTestId('item-state-source')).toHaveText('from git');
    await expect(line.getByTestId('item-state-recorded')).toHaveCount(0);
  });
});
