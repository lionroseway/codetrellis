/**
 * Playing the plans forward, in the window (Phase 32 B9.2, JOURNEYS G3).
 *
 * Sam has two plans in the sample app: one rounds VAT in validators.ts, the
 * other adds a currency field to validators.ts and creates currency.ts. In
 * the Stack tab he presses "Play the plans forward": the bar says the clock
 * runs from now to all plans done, how much is planned, and "◇ planned
 * overlap: … both plan to change packages/shared/src/validators.ts"; the
 * graph draws the overlap as a dashed zone on the cluster that holds it, and
 * the canvas says nothing dashed exists yet; each plan in the stack says
 * where it will meet the other. The views wait while he plays forward.
 * "Back to now" puts everything back. The plans and the answer are real.
 */

import fs from 'node:fs';
import path from 'node:path';
import { test, expect } from '@playwright/test';
import { cleanupPlans, gotoWithProject, seedPlan, FIXTURE_PATH } from '../helpers/setup';

const OUT = path.join('test-results', 'ux-audit');
const VALIDATORS = 'packages/shared/src/validators.ts';

test.describe('Playing the plans forward', () => {
  test.setTimeout(120_000);
  test.use({ viewport: { width: 1440, height: 900 } });
  test.afterEach(async ({ request }) => { await cleanupPlans(request, 'E2E B9'); });

  test('the stack plays forward: the bar, the dashed zone, each plan\'s planned overlap, then back to now', async ({ page, request }) => {
    const tag = Math.random().toString(36).slice(2, 6);
    const VAT = `E2E B9 VAT rounding ${tag}`;
    const CURRENCY = `E2E B9 Currency ${tag}`;
    const vat = await seedPlan(request, { title: VAT, projectPath: FIXTURE_PATH, actions: [{ title: 'Round VAT per line', fileSpecs: [{ path: VALIDATORS, action: 'modify' }] }] });
    await seedPlan(request, {
      title: CURRENCY, projectPath: FIXTURE_PATH,
      actions: [{ title: 'Add a currency field', fileSpecs: [{ path: VALIDATORS, action: 'modify' }, { path: 'packages/shared/src/currency.ts', action: 'create' }] }],
    });

    await gotoWithProject(page, { projectPath: FIXTURE_PATH });
    await page.getByRole('button', { name: 'Stack', exact: true }).first().click();
    await page.getByTestId('play-forward-start-stack').click();

    const bar = page.getByTestId('play-forward-bar');
    await expect(bar).toBeVisible();
    await expect(page.getByTestId('play-forward-range')).toHaveText('◇ Playing forward · now → all plans done');
    await expect(page.getByTestId('play-forward-words')).toContainText(/^Planned by \d+ active plans? · .+ · nothing here exists yet$/);
    const ours = new RegExp(`^◇ planned overlap: (${VAT}|${CURRENCY}) and (${VAT}|${CURRENCY}) both plan to change packages/shared/src/validators\\.ts$`);
    await expect(page.getByTestId('play-forward-overlap').filter({ hasText: ours })).toHaveCount(1, { timeout: 10_000 });

    // The canvas says what it shows, and draws the zone dashed on the cluster holding the file.
    await expect(page.getByTestId('play-forward-canvas')).toContainText(/◇ Playing forward · now → all plans done · planned by \d+ active plans · \d+ planned overlaps? · nothing dashed exists yet/);
    const zone = page.locator(`[data-testid="node-planned-overlap"][title*="${VAT}"]`);
    await expect(zone.first()).toBeVisible({ timeout: 15_000 });
    await expect(zone.first()).toHaveAttribute('title', new RegExp(`both plan to change packages/shared/src/validators\\.ts`));

    // Each plan says where it will meet the other.
    const vatRow = page.locator(`[data-testid="stack-plan"][data-plan-uid="${vat.uid}"]`);
    await expect(vatRow.getByTestId('stack-planned-overlap')).toHaveText(`◇ will overlap ${CURRENCY}: validators.ts`);

    // The views wait while playing forward.
    await expect(page.getByRole('button', { name: 'Live', exact: true }).first()).toBeDisabled();

    fs.mkdirSync(OUT, { recursive: true });
    await bar.screenshot({ path: path.join(OUT, 'play-forward-bar.png') });
    await vatRow.screenshot({ path: path.join(OUT, 'play-forward-stack.png') });
    await page.screenshot({ path: path.join(OUT, 'play-forward-window.png') });

    // Back to now: the bar, the canvas note, the zones and the stack's lines go.
    await page.getByTestId('play-forward-now').click();
    await expect(bar).toHaveCount(0);
    await expect(page.getByTestId('play-forward-canvas')).toHaveCount(0);
    await expect(page.getByTestId('node-planned-overlap')).toHaveCount(0);
    await expect(vatRow.getByTestId('stack-planned-overlap')).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Live', exact: true }).first()).toBeEnabled();
  });
});
