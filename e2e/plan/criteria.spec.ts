/**
 * Phase 31.1 — the Acceptance criteria section of the item canvas.
 *
 * Covers: a body's `## Acceptance criteria` checklist appearing as rows,
 * approving, sending back with a note, adding a criterion, and the gate
 * toggle standing for a "Reviewed and approved" criterion. States are a
 * glyph and a word (§10.4), so the checks read the words.
 */

import { test, expect } from '@playwright/test';
import { gotoWithProject, seedPlan, openPlan, cleanupPlans } from '../helpers/setup';

test.describe('Acceptance criteria', () => {
  // Unique per test: openPlan clicks the first plan with this title, and on a
  // shared backend with parallel workers a fixed title can be another test's.
  const planTitle = () => `E2E Criteria ${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;

  test.afterEach(async ({ request }) => {
    await cleanupPlans(request, 'E2E Criteria');
  });

  test('a body checklist becomes criteria a person can approve and send back', async ({ page, request }) => {
    await gotoWithProject(page);
    const PLAN_TITLE = planTitle();
    await seedPlan(request, {
      title: PLAN_TITLE,
      actions: [{
        title: 'Revenue summary',
        body: 'Summarise Q3.\n\n## Acceptance criteria\n- [ ] EMEA totals match the ledger\n',
      }],
    });
    await openPlan(page, PLAN_TITLE);
    await page.getByTestId('plan-item-tree').getByText('Revenue summary').first().click();

    const block = page.getByTestId('criteria-block');
    await expect(block.getByText('EMEA totals match the ledger')).toBeVisible({ timeout: 10_000 });
    await expect(block.getByText('0/1 met')).toBeVisible();
    await expect(block.getByText('not yet')).toBeVisible();

    await block.getByRole('button', { name: /Approve/ }).click();
    await expect(block.getByText('1/1 met')).toBeVisible();
    await expect(page.getByTestId('criterion-row').first()).toHaveAttribute('data-state', 'met');

    await block.getByRole('button', { name: /Send back/ }).click();
    const send = block.getByRole('button', { name: 'Send back', exact: true });
    await expect(send, 'a send-back needs a note').toBeDisabled();
    await block.getByPlaceholder(/What isn't right/).fill('EMEA excludes the Nordics restatement');
    await send.click();
    await expect(page.getByTestId('criterion-row').first()).toHaveAttribute('data-state', 'sent_back');
    // Scoped to the rows: for a moment the composer still holds the same words.
    // The ↩ line, not the composer: for a moment both hold the same words.
    await expect(page.getByTestId('criterion-row').getByText(/^↩ EMEA excludes the Nordics restatement/)).toBeVisible();
  });

  test('adding a criterion, and the gate standing for one', async ({ page, request }) => {
    await gotoWithProject(page);
    const PLAN_TITLE = planTitle();
    await seedPlan(request, { title: PLAN_TITLE, actions: [{ title: 'Board deck', body: 'Build it.' }] });
    await openPlan(page, PLAN_TITLE);
    await page.getByTestId('plan-item-tree').getByText('Board deck').first().click();

    const block = page.getByTestId('criteria-block');
    await block.getByRole('button', { name: /Add acceptance criterion/ }).click();
    await block.getByPlaceholder(/requester's words/).fill('Every chart has a source line');
    await block.getByRole('combobox').selectOption('artefact');
    await block.getByRole('button', { name: 'Add', exact: true }).click();
    await expect(page.getByTestId('criterion-row').getByText('Every chart has a source line')).toBeVisible();

    // The gate toggle adds a person-only criterion — and removes it again.
    await page.getByRole('button', { name: /Gate/ }).click();
    await expect(block.getByText('Reviewed and approved')).toBeVisible({ timeout: 10_000 });
    await expect(block.getByText('0/2 met')).toBeVisible();
    await page.getByRole('button', { name: /Gate/ }).click();
    await expect(block.getByText('Reviewed and approved')).toHaveCount(0, { timeout: 10_000 });
  });
});
