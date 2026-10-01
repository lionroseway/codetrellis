/**
 * The stack, on the phone (Phase 32 B6.6), journey H1.
 *
 * Sam checks from the phone what is in flight. Two plans are under way:
 * Billing v2, with Codex on "Migrate schema" on billing-v2, and JIRA-150
 * (Exports), whose "Deploy exports" waits on it. The two meet on a file,
 * and each says so in words. A plan opens to its detail. The way in is the
 * Plans tab.
 *
 * The desktop's side (`stack.summary`) is served here as the RPC answer;
 * tests/e2e/stack.test.ts checks it against a real backend and a paired phone.
 */
import { test, expect } from '@playwright/test';
import { openScreen, navigations, shot } from './helpers';

const task = (over: Record<string, unknown>) => ({
  parentUid: null, kind: 'action', status: 'pending', assignee: null, workstream: null, ticketKey: null,
  dependencies: [], waits: null, ...over,
});
const overlap = (withPlanUid: string, withLabel: string, high = false) => ({
  withPlanUid, withLabel, high, words: `⚠ overlaps ${withLabel}`,
  detail: high ? 'Both plan to change src/billing/charge.ts. Open now: billing-v2 and exports-v1 both change charge.ts → total' : 'Both plan to change src/billing/charge.ts.',
});

const STACK = {
  project: '/work/acme',
  plans: [
    {
      uid: 'p-billing', title: 'Billing v2', ticketKey: null, label: 'Billing v2', progress: { done: 1, total: 3 }, needsYou: 1,
      overlaps: [overlap('p-exports', 'JIRA-150', true)],
      tasks: [
        task({ uid: 'i1', title: 'Migrate schema', status: 'in_progress', assignee: 'codex', workstream: 'billing-v2' }),
        task({ uid: 'i2', title: 'Backfill invoices', status: 'done', assignee: 'claude-code' }),
        task({ uid: 'i3', title: 'Remove old table' }),
      ],
    },
    {
      uid: 'p-exports', title: 'Exports', ticketKey: 'JIRA-150', label: 'JIRA-150', progress: { done: 0, total: 1 }, needsYou: 0,
      arrival: 'from Priya Shah, in 3f9c2e1',
      overlaps: [overlap('p-billing', 'Billing v2', true)],
      tasks: [
        task({
          uid: 'i4', title: 'Deploy exports', workstream: 'exports-v1',
          dependencies: [{ uid: 'i1', met: false, problem: 'unfinished', title: 'Migrate schema', planUid: 'p-billing', planTitle: 'Billing v2', words: '“Migrate schema” in plan “Billing v2”' }],
          waits: '“Deploy exports” waits on “Migrate schema” in plan “Billing v2”.',
        }),
      ],
    },
  ],
};

test.describe('The stack', () => {
  test('every plan under way: progress, overlaps in words, who is on what, what is waiting; a plan opens', async ({ page }) => {
    await openScreen(page, 'stack', { rpc: { 'stack.summary': STACK } });
    const plans = page.getByTestId('stack-plan');
    await expect(plans).toHaveCount(2);
    await expect(page.getByText('2 plans under way, with who is on what and where they meet.')).toBeVisible();

    const billing = plans.first();
    await expect(billing).toContainText('1/3');
    await expect(billing.getByTestId('stack-needs-you')).toHaveText('1 needs you');
    await expect(billing.getByTestId('stack-overlap')).toContainText('⚠ overlaps JIRA-150');
    await expect(billing.getByTestId('stack-overlap')).toContainText('Open now: billing-v2 and exports-v1 both change charge.ts → total');
    // Only unfinished work someone has: the done task is not "on it".
    await expect(billing.getByTestId('stack-on-it')).toHaveText(['codex · Migrate schema · ⎇ billing-v2']);

    const exportsPlan = plans.nth(1);
    await expect(exportsPlan).toContainText('JIRA-150');
    await expect(exportsPlan).toContainText('Exports');
    // A teammate's plan, as git says it arrived (C2.6a); Sam's own says nothing of the kind.
    await expect(exportsPlan.getByTestId('stack-plan-arrival')).toHaveText('from Priya Shah, in 3f9c2e1');
    await expect(billing.getByTestId('stack-plan-arrival')).toHaveCount(0);
    await expect(exportsPlan.getByTestId('stack-wait')).toHaveText('↑ “Deploy exports” waits on “Migrate schema” in plan “Billing v2”.');
    await expect(exportsPlan.getByTestId('stack-on-it')).toHaveCount(0);
    await shot(page, 'stack');

    await exportsPlan.click();
    expect(await navigations(page)).toEqual([{ action: 'push', to: '/plan-detail?uid=p-exports' }]);
  });

  test('nothing under way says what would show here', async ({ page }) => {
    await openScreen(page, 'stack', { rpc: { 'stack.summary': { project: '/work/acme', plans: [] } } });
    await expect(page.getByText('No plan is under way')).toBeVisible();
    await expect(page.getByText(/A plan shows here from when it is created/)).toBeVisible();
  });

  test('an error is shown, not a blank', async ({ page }) => {
    await openScreen(page, 'stack', { rpc: { 'stack.summary': { __error: 'No active project on the desktop' } } });
    await expect(page.getByText('No active project on the desktop')).toBeVisible();
  });
});
