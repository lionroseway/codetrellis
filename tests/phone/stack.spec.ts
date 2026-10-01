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
import { openScreen, navigations, shot, calls } from './helpers';

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

// Played forward (B9.4, JOURNEYS G3): Billing v2 and JIRA-150 both plan to change charge.ts.
const WORDS = '◇ planned overlap: Billing v2 and JIRA-150 both plan to change src/billing/charge.ts';
const PLANNED = {
  id: 'po-1', kind: 'file', subject: 'src/billing/charge.ts', file: 'src/billing/charge.ts',
  plans: [
    { uid: 'p-billing', label: 'Billing v2', tasks: [{ uid: 'i3', title: 'Remove old table', change: 'modify' }] },
    { uid: 'p-exports', label: 'JIRA-150', tasks: [{ uid: 'i4', title: 'Deploy exports', change: 'modify' }] },
  ],
  serious: false, sequenced: false, words: WORDS, decisions: [] as unknown[], left: false,
};
const at = new Date(2026, 9, 1, 18, 57).getTime();
const FORWARD = {
  project: '/work/acme',
  plans: [{ uid: 'p-billing', label: 'Billing v2', ahead: 2 }, { uid: 'p-exports', label: 'JIRA-150', ahead: 1 }],
  overlaps: [PLANNED],
  words: 'Planned by 2 active plans · 1 file to change · 1 planned overlap',
  notices: [{ id: 7, planUid: 'p-exports', planLabel: 'JIRA-150', title: 'Approving JIRA-150 puts it in a planned overlap', overlaps: [WORDS], at }],
};
const RESEQUENCED = {
  ...FORWARD,
  overlaps: [{
    ...PLANNED, sequenced: true, words: `${WORDS} · sequenced: JIRA-150 waits on Billing v2`,
    decisions: [{ action: 'resequence', words: 'Billing v2 goes first; JIRA-150 waits', by: 'Sam', byType: 'human', at }],
  }],
  words: 'Planned by 2 active plans · 1 file to change · 1 planned overlap (1 sequenced)',
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

  test('B9.4: played forward, where the plans will meet, and Sam re-sequences them from the phone', async ({ page }) => {
    await openScreen(page, 'stack', { rpc: { 'stack.summary': STACK, 'playForward.summary': FORWARD, 'playForward.decide': { playForward: RESEQUENCED } } });
    const planned = page.getByTestId('planned-overlaps');
    await expect(planned.getByTestId('planned-words')).toHaveText('Planned by 2 active plans · 1 file to change · 1 planned overlap');
    // The approval that formed it, said once until it is seen on the desktop.
    await expect(planned.getByTestId('planned-notice')).toHaveText('Approving JIRA-150 puts it in a planned overlap');
    await expect(planned.getByTestId('planned-overlap-words')).toHaveText(WORDS);
    await expect(planned.getByTestId('planned-overlap-decision')).toHaveCount(0);
    // Each plan says where it will meet the other, as the desktop's stack does.
    await expect(page.getByTestId('stack-plan').first().getByTestId('stack-plan-planned')).toHaveText('◇ will overlap JIRA-150: charge.ts');
    await expect(page.getByTestId('stack-plan').nth(1).getByTestId('stack-plan-planned')).toHaveText('◇ will overlap Billing v2: charge.ts');
    await shot(page, 'stack-planned-overlap');

    await planned.getByTestId('planned-resequence').click();
    await expect(planned.getByTestId('planned-choose-first')).toContainText('Which goes first?');
    await shot(page, 'stack-planned-choose-first');
    const asked = (await calls(page)).filter((c) => c.method === 'stack.summary').length;
    await planned.getByTestId('planned-first').filter({ hasText: 'Billing v2 first' }).click();
    expect((await calls(page)).filter((c) => c.method === 'playForward.decide').map((c) => c.params))
      .toEqual([{ overlapId: 'po-1', action: 'resequence', first: 'p-billing' }]);
    // The stack is asked again: re-sequencing changes what waits on what.
    await expect.poll(async () => (await calls(page)).filter((c) => c.method === 'stack.summary').length).toBe(asked + 1);

    await expect(planned.getByTestId('planned-overlap-words')).toHaveText(`${WORDS} · sequenced: JIRA-150 waits on Billing v2`);
    await expect(planned.getByTestId('planned-overlap-decision')).toHaveText('Billing v2 goes first; JIRA-150 waits · Sam · 18:57');
    // Sequenced, there is nothing left to decide.
    await expect(planned.getByTestId('planned-resequence')).toHaveCount(0);
    await expect(page.getByTestId('stack-plan').first().getByTestId('stack-plan-planned')).toHaveText('◇ will overlap JIRA-150: charge.ts (sequenced)');
    await shot(page, 'stack-planned-resequenced');
  });

  test('B9.4: leave it from the phone; a refusal is said where it was asked', async ({ page }) => {
    const LEFT = { ...FORWARD, overlaps: [{ ...PLANNED, left: true, decisions: [{ action: 'leave', words: 'Left as it is by Sam', by: 'Sam', byType: 'human', at }] }] };
    await openScreen(page, 'stack', { rpc: { 'stack.summary': STACK, 'playForward.summary': FORWARD, 'playForward.decide': { playForward: LEFT } } });
    const planned = page.getByTestId('planned-overlaps');
    await planned.getByTestId('planned-leave').click();
    await expect(planned.getByTestId('planned-overlap-decision')).toHaveText('Left as it is by Sam · 18:57');
    await expect(planned.getByTestId('planned-leave')).toHaveCount(0);
    expect((await calls(page)).filter((c) => c.method === 'playForward.decide').map((c) => c.params)).toEqual([{ overlapId: 'po-1', action: 'leave' }]);

    await openScreen(page, 'stack', { rpc: { 'stack.summary': STACK, 'playForward.summary': FORWARD, 'playForward.decide': { __error: 'No such planned overlap: the plans changed since.' } } });
    await page.getByTestId('planned-tell').click();
    await expect(page.getByTestId('planned-error')).toHaveText('No such planned overlap: the plans changed since.');
  });

  test('B9.4: a desktop without play-forward still shows the stack, and nothing planned', async ({ page }) => {
    await openScreen(page, 'stack', { rpc: { 'stack.summary': STACK } });
    await expect(page.getByTestId('stack-plan')).toHaveCount(2);
    await expect(page.getByTestId('planned-overlaps')).toHaveCount(0);
    await expect(page.getByTestId('stack-plan-planned')).toHaveCount(0);
  });
});
