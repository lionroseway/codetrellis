/**
 * A long plan name, and a long heading in a plan's document, wrap rather than
 * being cut off. The header put the plan's name on one line beside a dozen
 * chips with `truncate`, so a long one showed as a few words and "…".
 */
import { test, expect, type Locator } from '@playwright/test';
import { gotoWithProject, seedPlan, openPlan, cleanupPlans } from '../helpers/setup';

const RUN = Math.random().toString(36).slice(2, 7);
const TITLE = `E2E Long name ${RUN}: move the billing service off the legacy invoice tables and onto the ledger, `
  + 'without downtime, behind a flag the support team can turn off, and with every old report still reconciling';
const PATH_WORD = `src/backend/services/${'a-very-long-folder-name/'.repeat(8)}ledger-migration.ts`;

/** Whether an element shows all of its text: nothing past its right edge. */
const clipped = (l: Locator) => l.evaluate((e) => e.scrollWidth > e.clientWidth + 1);

test.describe('Long headings on a plan', () => {
  test.afterEach(async ({ request }) => { await cleanupPlans(request, TITLE); });

  test('the plan name wraps in the header, and a long heading in a document wraps too', async ({ page, request }) => {
    await seedPlan(request, { title: TITLE, actions: [{ title: 'Where it starts', body: `## Start from ${PATH_WORD}\n\nThe rest.` }] });
    await gotoWithProject(page);
    await openPlan(page, TITLE);

    const name = page.getByTestId('plan-header-title');
    await expect(name).toHaveText(TITLE);
    expect(await clipped(name), 'the whole name shows').toBe(false);
    const lines = await name.evaluate((e) => e.getBoundingClientRect().height / parseFloat(getComputedStyle(e).lineHeight));
    expect(lines, 'on more than one line').toBeGreaterThan(1.5);

    await page.getByTestId('plan-item-tree').getByText('Where it starts').first().click();
    const heading = page.getByRole('heading', { name: /Start from src\/backend\/services/ });
    await expect(heading).toBeVisible();
    expect(await clipped(heading), 'a heading with a long path wraps').toBe(false);
    // The name stays whole with a task open too, as the way back to the plan.
    expect(await clipped(name)).toBe(false);
  });
});
