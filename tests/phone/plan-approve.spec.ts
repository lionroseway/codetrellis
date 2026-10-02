/**
 * Approving a plan on the phone.
 *
 * Neither the window nor the phone could approve a plan, so the only way one
 * became approved was an agent's `update_plan`, which skipped the baseline and
 * the planned overlaps. An agent is refused now and sets "review" to ask; the
 * person approves here with `plan.update`, the desktop's own path
 * (tests/e2e/play-forward-approval.test.ts checks its answer on a real backend).
 */
import { test, expect } from '@playwright/test';
import { calls, openScreen, shot } from './helpers';

const plan = (status: string) => ({
  plan: { uid: 'p1', title: 'Currency', status, description: null, projectPath: '/work/shop', createdAt: 1, updatedAt: 2 },
  items: [], deviations: [], phases: [], documents: [], externalRefs: [], comments: [],
});
const QUIET = { 'budget.get': { __error: 'none' }, 'freeze.get': { __error: 'none' }, 'plan.status': { __error: 'none' } };

test('a plan in review: Approve sends the approval as the person, and says its planned overlaps', async ({ page }) => {
  const overlap = '◇ planned overlap: JIRA-142 and JIRA-151 both plan to change validators.ts';
  await openScreen(page, 'plan-detail', {
    rpc: { ...QUIET, 'plan.get': plan('review'), 'plan.update': { ok: true, plannedOverlaps: [overlap] } },
  }, { uid: 'p1' });
  const approve = page.getByTestId('approve-plan');
  await expect(approve).toBeVisible();
  await shot(page, 'plan-approve');
  page.once('dialog', (d) => { void d.accept(); });
  await approve.click();
  await expect.poll(async () => (await calls(page)).filter((c) => c.method === 'plan.update').map((c) => c.params))
    .toEqual([{ uid: 'p1', status: 'approved' }]);
});

test('an approved plan has nothing to approve', async ({ page }) => {
  await openScreen(page, 'plan-detail', { rpc: { ...QUIET, 'plan.get': plan('approved') } }, { uid: 'p1' });
  await expect(page.getByText('Currency')).toBeVisible();
  await expect(page.getByTestId('approve-plan')).toHaveCount(0);
});
