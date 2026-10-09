/**
 * Long names on a plan. The open page's name in the breadcrumb, above the
 * document, was cut at 260px however much room the pane had; it now shows in
 * full and wraps if it must. The plan's name in the header stays one line
 * beside its chips, with the whole name on hover. Long headings in a
 * document wrap rather than run off the edge.
 */
import { test, expect, type Locator } from '@playwright/test';
import { gotoWithProject, seedPlan, openPlan, cleanupPlans } from '../helpers/setup';

const RUN = Math.random().toString(36).slice(2, 7);
const TITLE = `E2E Long name ${RUN}: move the billing service off the legacy invoice tables and onto the ledger, `
  + 'without downtime, behind a flag the support team can turn off, and with every old report still reconciling';
const PAGE = 'Where it starts: the invoice tables, the two reports that still read them, and the nightly export to finance';
const PATH_WORD = `src/backend/services/${'a-very-long-folder-name/'.repeat(8)}ledger-migration.ts`;

/** Whether an element shows all of its text: nothing past its right edge. */
const clipped = (l: Locator) => l.evaluate((e) => e.scrollWidth > e.clientWidth + 1);

test.describe('Long names on a plan', () => {
  test.afterEach(async ({ request }) => { await cleanupPlans(request, TITLE); });

  test('the open page is named in full above its document; the plan name stays one line with the whole name on hover', async ({ page, request }) => {
    await seedPlan(request, { title: TITLE, actions: [{ title: PAGE, body: `## Start from ${PATH_WORD}\n\nThe rest.` }] });
    await gotoWithProject(page);
    await openPlan(page, TITLE);
    await page.getByTestId('plan-item-tree').getByText(PAGE).first().click();

    // The breadcrumb: the page open, whole.
    const crumb = page.getByTestId('item-breadcrumb-current');
    await expect(crumb).toHaveText(PAGE);
    expect(await clipped(crumb.locator('span').last()), 'the whole page name shows').toBe(false);

    // The header: one line beside the chips, the whole name on hover.
    const name = page.getByTestId('plan-header-title');
    await expect(name).toHaveAttribute('title', `Back to ${TITLE}`);
    const lines = await name.evaluate((e) => e.getBoundingClientRect().height / parseFloat(getComputedStyle(e).lineHeight));
    expect(lines, 'one line').toBeLessThan(1.5);
    expect((await name.textContent())?.length, 'the start of the name shows, not one letter').toBeGreaterThan(0);
    expect(await name.evaluate((e) => e.clientWidth), 'wide enough to read the start of the name').toBeGreaterThanOrEqual(100);
    expect(await clipped(page.getByTestId('plan-header')), 'nothing in the header runs past its edge').toBe(false);

    // A heading in the document with a long path wraps.
    const heading = page.getByRole('heading', { name: /Start from src\/backend\/services/ });
    await expect(heading).toBeVisible();
    expect(await clipped(heading), 'a heading with a long path wraps').toBe(false);
  });
});
