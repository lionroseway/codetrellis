/**
 * Approvals as signed statements, from the window (Phase 32 C2.5b).
 *
 * Priya opens "Check the figures" after a pull. Under each criterion she
 * reads what became of its approval: Dana's verified against the team's
 * allowed signers, one that claims to be hers and does not verify (and
 * counts for nothing), one signed here with her own git key, and one kept
 * on this machine because git signing is not set up, each saying why.
 *
 * The criteria are real; the signed approvals are given (the backend's
 * side, across two machines with real SSH keys, is
 * tests/e2e/signed-approvals.test.ts).
 */

import fs from 'node:fs';
import path from 'node:path';
import { test, expect } from '@playwright/test';
import { API, authHeaders, gotoWithProject, openPlan, seedPlan, cleanupPlans } from '../helpers/setup';

const OUT = path.join('test-results', 'ux-audit');
const PLAN = 'E2E C2.5b signed approvals';

test.describe('Approvals as signed statements', () => {
  test.afterEach(async ({ request }) => { await cleanupPlans(request, PLAN); });

  test('under each criterion: verified, can\'t verify, signed here, or kept on this machine, each with why', async ({ page, request }) => {
    const plan = await seedPlan(request, { title: PLAN, actions: [{ title: 'Check the figures' }] });
    const item = plan.actionUids[0];
    const texts = ['Figures reconcile to the ledger', 'Notes reviewed', 'Totals tie out', 'Board notified'];
    for (const text of texts) {
      expect((await request.post(`${API}/items/${item}/criteria`, { headers: authHeaders(), data: { text, kind: 'manual' } })).ok()).toBeTruthy();
    }
    const criteria = (await (await request.get(`${API}/items/${item}/criteria`, { headers: authHeaders() })).json()) as Array<{ uid: string; text: string }>;
    const uidOf = (text: string) => criteria.find((c) => c.text === text)!.uid;
    const at = Date.UTC(2026, 8, 26, 14, 2);
    const row = (criterionUid: string, over: Record<string, unknown>) => ({ uid: `${criterionUid}-a`, planUid: plan.uid, itemUid: item, criterionUid, at, reason: null, ...over });
    const SIGNED = [
      row(uidOf('Figures reconcile to the ledger'), { origin: 'file', state: 'verified', signer: 'dana@acme.test' }),
      row(uidOf('Notes reviewed'), { origin: 'file', state: 'unverified', signer: 'priya@acme.test', reason: 'the signature does not verify for priya@acme.test' }),
      row(uidOf('Totals tie out'), { origin: 'here', state: 'signed', signer: 'priya@acme.test' }),
      row(uidOf('Board notified'), { origin: 'here', state: 'local', signer: null, reason: 'git signing is not set up with an SSH key (gpg.format ssh), so the approval stays on this machine' }),
    ];
    await page.route(`**/api/items/${item}/signed-approvals`, (route) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(SIGNED) }));

    await gotoWithProject(page);
    await openPlan(page, PLAN);
    await page.getByText('Check the figures', { exact: true }).first().click();

    const block = page.getByTestId('criteria-block');
    const lineOf = (text: string) => block.getByTestId('criterion-row').filter({ hasText: text }).getByTestId('signed-approval');
    await expect(lineOf('Figures reconcile to the ledger')).toHaveText('✓ verified, signed by dana@acme.test on 26 Sept');
    await expect(lineOf('Notes reviewed')).toHaveText("⚠ can't verify an approval claiming to be priya@acme.test: the signature does not verify for priya@acme.test. It counts for nothing.");
    await expect(lineOf('Notes reviewed')).toHaveAttribute('data-state', 'unverified');
    await expect(lineOf('Totals tie out')).toHaveText("✓ signed with your git key as priya@acme.test, in the plan's folder");
    await expect(lineOf('Board notified')).toHaveText('· kept on this machine: git signing is not set up with an SSH key (gpg.format ssh), so the approval stays on this machine');
    fs.mkdirSync(OUT, { recursive: true });
    await block.screenshot({ path: path.join(OUT, 'signed-approvals.png') });
  });
});
