import { test } from '@playwright/test';
import { gotoWithProject, gotoWelcome, seedPlan, API, PROJECT_PATH } from '../helpers/setup';

/**
 * Where a capture goes. `screenshots/` is committed, and every run used to
 * rewrite it with whatever test data happened to be loaded — so a plain
 * test run left a dirty tree. Refresh the committed set with
 * E2E_SCREENSHOTS=1; otherwise captures land in test-results/.
 */
const shot = (name: string) =>
  process.env.E2E_SCREENSHOTS ? `screenshots/${name}` : `test-results/screenshots/${name}`;

test.describe('Screenshot capture', () => {
  test.setTimeout(60000);

  test.beforeAll(async ({ request }) => {
    // Pre-scan so backend is ready
    await request.post(`${API}/project/scan`, { data: { projectPath: PROJECT_PATH } });
  });

  test('01 - Welcome screen', async ({ page }) => {
    await gotoWelcome(page, { skipLearnTrellis: true });
    await page.waitForTimeout(1500);
    await page.screenshot({ path: shot('01-welcome.png'), fullPage: true });
  });

  test('02 - Map view packages', async ({ page }) => {
    await gotoWithProject(page);
    await page.screenshot({ path: shot('02-map-packages.png'), fullPage: true });
  });

  test('03 - Tree view packages', async ({ page }) => {
    await gotoWithProject(page);
    const btn = page.locator('button:has-text("Tree")');
    if (await btn.isVisible({ timeout: 3000 }).catch(() => false)) {
      await btn.click();
      await page.waitForTimeout(1500);
    }
    await page.screenshot({ path: shot('03-tree-packages.png'), fullPage: true });
  });

  test('04 - Map view files', async ({ page }) => {
    await gotoWithProject(page);
    await page.locator('button:has-text("Files")').first().click();
    await page.waitForTimeout(1500);
    await page.screenshot({ path: shot('04-map-files.png'), fullPage: true });
  });

  test('05 - Map view symbols', async ({ page }) => {
    await gotoWithProject(page);
    await page.locator('button:has-text("Symbols")').first().click();
    await page.waitForTimeout(1500);
    await page.screenshot({ path: shot('05-map-symbols.png'), fullPage: true });
  });

  test('06 - Inspector with file selected', async ({ page }) => {
    await gotoWithProject(page);
    const file = page.locator('text=server.ts').first();
    if (await file.isVisible({ timeout: 3000 }).catch(() => false)) {
      await file.click();
      await page.waitForTimeout(800);
    }
    await page.screenshot({ path: shot('06-inspector.png'), fullPage: true });
  });

  test('07 - Plans list', async ({ page }) => {
    await gotoWithProject(page);
    await page.getByRole('button', { name: 'Plans', exact: true }).first().click();
    await page.waitForTimeout(500);
    await page.screenshot({ path: shot('07-plans-list.png'), fullPage: true });
  });

  test('08 - Plan with projection', async ({ page, request }) => {
    await request.post(`${API}/plans`, {
      data: {
        title: 'Add Auth System',
        description: 'JWT auth with middleware and protected routes',
        projectPath: PROJECT_PATH,
      },
    });

    await gotoWithProject(page);
    await page.getByRole('button', { name: 'Plans', exact: true }).first().click();
    await page.waitForTimeout(300);
    const plan = page.locator('text=Add Auth System').first();
    if (await plan.isVisible({ timeout: 3000 }).catch(() => false)) {
      await plan.click();
      await page.waitForTimeout(3000);
    }
    await page.screenshot({ path: shot('08-plan-projection.png'), fullPage: true });
  });

  test('09 - Comments', async ({ page, request }) => {
    const plansRes = await request.get(`${API}/plans`);
    const plans = await plansRes.json();
    if (plans.length > 0) {
      const uid = plans[0].uid;
      await request.post(`${API}/comments`, { data: { targetType: 'plan', targetUid: uid, body: 'Use RS256 for better security', commentType: 'suggestion' } });
      await request.post(`${API}/comments`, { data: { targetType: 'plan', targetUid: uid, body: 'Approved, looks good', commentType: 'approval' } });
    }
    await gotoWithProject(page);
    await page.getByRole('button', { name: 'Plans', exact: true }).first().click();
    await page.waitForTimeout(300);
    const planItem = page.locator('.truncate.font-medium').first();
    if (await planItem.isVisible({ timeout: 3000 }).catch(() => false)) {
      await planItem.click();
      await page.waitForTimeout(1000);
    }
    await page.locator('button:has-text("Comments")').first().click();
    await page.waitForTimeout(500);
    await page.screenshot({ path: shot('09-comments.png'), fullPage: true });
  });

  test('10 - MCP guide', async ({ page }) => {
    await gotoWelcome(page, { skipLearnTrellis: true });
    await page.waitForTimeout(500);
    await page.locator('button:has-text("Connect Agent")').first().click();
    await page.waitForTimeout(500);
    await page.screenshot({ path: shot('10-mcp-guide.png'), fullPage: true });
  });

  test('11 - Create plan modal', async ({ page }) => {
    await gotoWithProject(page);
    await page.getByRole('button', { name: 'Plans', exact: true }).first().click();
    await page.waitForTimeout(300);
    const newBtn = page.locator('text=New').first();
    if (await newBtn.isVisible({ timeout: 3000 }).catch(() => false)) {
      await newBtn.click();
      await page.waitForTimeout(500);
    }
    await page.screenshot({ path: shot('11-create-plan.png'), fullPage: true });
  });

  test('12 - Timeline', async ({ page }) => {
    await gotoWithProject(page);
    await page.locator('button:has-text("Timeline")').first().click();
    await page.waitForTimeout(500);
    await page.screenshot({ path: shot('12-timeline.png'), fullPage: true });
  });
});
