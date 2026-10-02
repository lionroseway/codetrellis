/**
 * One plan across worktrees, seen (Phase 32 C5.3a).
 *
 * "Checkout v2" is split: Billing is kept to checkout-v2-billing, Exports to
 * exports, and one task is left to any worktree.
 * 1. In the plan tree, each section carries its worktree: ⎇ checkout-v2-billing.
 * 2. Under the header, progress reads per worktree: "checkout-v2-billing:
 *    1 of 2 · exports: 0 of 1 · any worktree: 0 of 1".
 * 3. On the Timeline lanes, each worktree's lane names the sections worked in it.
 *
 * The plan's items and the room are given, so the split is exact.
 */

import fs from 'node:fs';
import path from 'node:path';
import { test, expect } from '@playwright/test';
import { gotoWithProject, openPlan, seedPlan, cleanupPlans } from '../helpers/setup';
import type { Workstream } from '../../src/shared/types';

const OUT = path.join('test-results', 'ux-audit');
const PLAN = 'E2E C5.3 plan across worktrees';

const ws = (root: string, branch: string, main = false): Workstream => ({
  root, branch, head: '3f9c2e1a7b', main, shape: 'worktree', agents: [],
  changes: { base: null, files: [], truncated: false }, idle: false,
} as unknown as Workstream);
const ROOM = [ws('/work/acme', 'main', true), ws('/work/acme-billing', 'checkout-v2-billing'), ws('/work/acme-exports', 'exports')];

test.describe('One plan across worktrees, seen', () => {
  test.afterEach(async ({ request }) => { await cleanupPlans(request, PLAN); });

  test('each section shows its worktree; progress per worktree; lanes name their sections', async ({ page, request }) => {
    const plan = await seedPlan(request, { title: PLAN, actions: [] });
    const at = Date.now();
    const item = (uid: string, parentUid: string | null, kind: 'object' | 'action', title: string, sortOrder: number, extra: Record<string, unknown> = {}) => ({
      uid, planUid: plan.uid, parentUid, sortOrder, kind, title, body: '', template: null,
      status: kind === 'action' ? 'pending' : null, assignee: null, assigneeType: null, assigneeModel: null,
      progressPercent: null, blockedReason: null, scopePath: null, fileSpecs: [], symbolSpecs: [], newConnections: [],
      removedConnections: [], dependencies: [], skills: [], skillsMode: 'inherit', claimPolicy: null, claimPolicyMode: 'inherit',
      executionConfig: null, executionConfigMode: 'inherit', constraints: null, constraintsMode: 'inherit', requiresApproval: false,
      author: 'Sam', authorType: 'human', createdAt: at, updatedAt: at, migratedFrom: null, visibility: 'shared',
      overrideParentVisibility: false, assigneeSession: null, workstream: null, ...extra,
    });
    const ITEMS = [
      item('c53-billing', null, 'object', 'Billing', 0, { workstream: 'checkout-v2-billing' }),
      item('c53-refunds', 'c53-billing', 'action', 'Partial refunds', 0, { status: 'done' }),
      item('c53-emails', 'c53-billing', 'action', 'Refund emails', 1),
      item('c53-exports', null, 'object', 'Exports', 1, { workstream: 'exports' }),
      item('c53-csv', 'c53-exports', 'action', 'CSV export', 0),
      item('c53-docs', null, 'action', 'Write the docs', 2),
    ];
    await page.route(`**/api/plans/${plan.uid}/items`, (route) => (route.request().method() === 'GET'
      ? route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(ITEMS) })
      : route.fallback()));
    await page.route('**/api/workstreams?*', (route) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(ROOM) }));
    await page.route('**/api/workstreams/commits?*', (route) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ since: at, commits: {} }) }));
    await page.route('**/api/awareness?*', (route) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ signals: [] }) }));

    await gotoWithProject(page);
    await openPlan(page, PLAN);

    const tree = page.getByTestId('plan-item-tree');
    // The tree's sections carry their worktree; a task under one does not repeat it.
    const row = (title: string) => tree.locator('[aria-current], div.group').filter({ hasText: title }).first();
    await expect(row('Billing').getByTestId('item-worktree')).toHaveText('⎇ checkout-v2-billing');
    await expect(row('Billing').getByTestId('item-worktree')).toHaveAttribute('title', 'Worked in checkout-v2-billing: its tasks are offered only to agents working there');
    await expect(row('Exports').getByTestId('item-worktree')).toHaveText('⎇ exports');
    await expect(tree.getByTestId('item-worktree')).toHaveCount(2);

    // With no distance from main to go on, readiness says it is not known (C5.3b).
    await expect(tree.getByTestId('worktree-progress-entry')).toHaveText([
      'checkout-v2-billing: 1 of 2 · not known how far from main', 'exports: 0 of 1 · not known how far from main', 'any worktree: 0 of 1',
    ]);
    fs.mkdirSync(OUT, { recursive: true });
    await tree.screenshot({ path: path.join(OUT, 'plan-across-worktrees-tree.png') });

    // The lanes name each worktree's sections.
    await page.keyboard.press('Escape');
    await expect(page.locator('button[title*="Restore plan workspace"]')).toBeVisible({ timeout: 5_000 });
    await page.getByRole('button', { name: /^Timeline( \d+)?$/ }).click();
    const lanes = page.getByTestId('timeline-lanes');
    await expect(lanes).toBeVisible({ timeout: 10_000 });
    const lane = (label: string) => lanes.locator(`[data-testid="timeline-lane"][data-lane="${label}"]`);
    await expect(lane('checkout-v2-billing').getByTestId('lane-sections')).toHaveText('Billing');
    await expect(lane('exports').getByTestId('lane-sections')).toHaveText('Exports');
    await expect(lane('main').getByTestId('lane-sections')).toHaveCount(0);
    await lanes.screenshot({ path: path.join(OUT, 'plan-across-worktrees-lanes.png') });
  });

  test('C5.3b: ready to merge per worktree, and an overlap between two sections names both', async ({ page, request }) => {
    const plan = await seedPlan(request, { title: PLAN, actions: [] });
    const at = Date.now();
    const item = (uid: string, parentUid: string | null, kind: 'object' | 'action', title: string, sortOrder: number, extra: Record<string, unknown> = {}) => ({
      uid, planUid: plan.uid, parentUid, sortOrder, kind, title, body: '', template: null,
      status: kind === 'action' ? 'pending' : null, assignee: null, assigneeType: null, assigneeModel: null,
      progressPercent: null, blockedReason: null, scopePath: null, fileSpecs: [], symbolSpecs: [], newConnections: [],
      removedConnections: [], dependencies: [], skills: [], skillsMode: 'inherit', claimPolicy: null, claimPolicyMode: 'inherit',
      executionConfig: null, executionConfigMode: 'inherit', constraints: null, constraintsMode: 'inherit', requiresApproval: false,
      author: 'Sam', authorType: 'human', createdAt: at, updatedAt: at, migratedFrom: null, visibility: 'shared',
      overrideParentVisibility: false, assigneeSession: null, workstream: null, ...extra,
    });
    const ITEMS = [
      item('c53b-billing', null, 'object', 'Billing', 0, { workstream: 'checkout-v2-billing' }),
      item('c53b-refunds', 'c53b-billing', 'action', 'Partial refunds', 0, { status: 'done' }),
      item('c53b-exports', null, 'object', 'Exports', 1, { workstream: 'exports' }),
      item('c53b-csv', 'c53b-exports', 'action', 'CSV export', 0),
    ];
    // Billing: 2 commits ahead, up to date, all committed. Exports: 1 behind main, 2 files not committed.
    const withChanges = (w: Workstream, c: Record<string, number>) => ({ ...w, changes: { ...w.changes, ...c } });
    const room = [ROOM[0], withChanges(ROOM[1], { ahead: 2, behind: 0, uncommitted: 0 }), withChanges(ROOM[2], { ahead: 1, behind: 1, uncommitted: 2 })];
    let signalState: 'open' | 'intended' = 'open';
    const signal = () => ({
      id: 'c53b-sig', kind: 'collision', severity: 'medium', subject: { file: 'src/billing/refund.ts' },
      workstreams: ['/work/acme-billing', '/work/acme-exports'],
      summary: '`checkout-v2-billing` and `exports` both change src/billing/refund.ts', firstSeen: at - 60_000, lastSeen: at, state: signalState,
    });
    await page.route(`**/api/plans/${plan.uid}/items`, (route) => (route.request().method() === 'GET'
      ? route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(ITEMS) })
      : route.fallback()));
    await page.route('**/api/workstreams?*', (route) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(room) }));
    await page.route('**/api/workstreams/commits?*', (route) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ since: at, commits: {} }) }));
    await page.route('**/api/awareness?*', (route) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ signals: [signal()] }) }));

    await gotoWithProject(page);
    await openPlan(page, PLAN);
    const tree = page.getByTestId('plan-item-tree');
    const readiness = tree.getByTestId('worktree-readiness');
    // The open overlap holds Billing back; Exports is behind main.
    await expect(readiness).toHaveText([' · 1 serious signal open', ' · 1 commit behind main']);
    await expect(readiness.nth(1)).toHaveAttribute('title', '1 commit behind main: bring main in first\n1 serious signal open\n2 files not committed');

    // The overlap names both sections of the plan.
    await page.keyboard.press('Escape');
    await expect(page.locator('button[title*="Restore plan workspace"]')).toBeVisible({ timeout: 5_000 });
    await page.getByRole('button', { name: /^Awareness( \d+)?$/ }).click();
    const card = page.getByTestId('awareness-signal').filter({ hasText: 'src/billing/refund.ts' });
    await expect(card.getByTestId('awareness-sides')).toContainText('(Billing)');
    await expect(card.getByTestId('awareness-sides')).toContainText('(Exports)');
    await expect(card.getByTestId('awareness-sections')).toHaveText(`Two sections of “${PLAN}”: Billing and Exports.`);
    fs.mkdirSync(OUT, { recursive: true });
    await card.screenshot({ path: path.join(OUT, 'plan-across-worktrees-overlap.png') });

    // Marked intended, it no longer holds Billing back: ready to merge.
    signalState = 'intended';
    await page.evaluate(() => window.dispatchEvent(new CustomEvent('awareness-changed')));
    await page.locator('button[title*="Restore plan workspace"]').click();
    await expect(readiness.first()).toHaveText(' · ✓ ready to merge');
    await expect(readiness.first()).toHaveAttribute('data-ready', 'true');
    await tree.screenshot({ path: path.join(OUT, 'plan-across-worktrees-ready.png') });
  });
});
