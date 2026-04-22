import { test } from '@playwright/test';

const API = 'http://localhost:3001/api';
const PROJECT_PATH = process.cwd();

/**
 * Open a project by scanning via API then injecting state into the page.
 * This bypasses the folder picker UI which is unreliable in tests.
 */
async function openProjectInPage(page: any, request: any) {
  // 1. Scan project via API so backend has data
  await request.post(`${API}/project/scan`, { data: { projectPath: PROJECT_PATH } });

  // 2. Navigate to the app
  await page.goto('/');
  await page.waitForTimeout(1000);

  // 3. Inject project state directly into Zustand stores via window
  await page.evaluate(async (projectPath: string) => {
    // Scan via the bridge API (same as clicking Open Project)
    const scanRes = await fetch('/api/project/scan', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ projectPath }),
    });
    const result = await scanRes.json();

    const branchRes = await fetch(`/api/git/branch?path=${encodeURIComponent(projectPath)}`);
    const { branch } = await branchRes.json();

    // Access React internals to find the Zustand stores
    // We'll dispatch a custom event that the app listens for
    window.dispatchEvent(new CustomEvent('__test_open_project__', {
      detail: { projectPath, branch, result }
    }));
  }, PROJECT_PATH);

  await page.waitForTimeout(4000);
}

test.describe('Screenshot capture', () => {
  test.setTimeout(60000);

  test.beforeAll(async ({ request }) => {
    // Pre-scan so backend is ready
    await request.post(`${API}/project/scan`, { data: { projectPath: PROJECT_PATH } });
  });

  test('01 - Welcome screen', async ({ page }) => {
    await page.goto('/');
    await page.waitForTimeout(1500);
    await page.screenshot({ path: 'screenshots/01-welcome.png', fullPage: true });
  });

  test('02 - Map view packages', async ({ page, request }) => {
    await openProjectInPage(page, request);
    await page.screenshot({ path: 'screenshots/02-map-packages.png', fullPage: true });
  });

  test('03 - Tree view packages', async ({ page, request }) => {
    await openProjectInPage(page, request);
    const btn = page.locator('button:has-text("Tree")');
    if (await btn.isVisible()) {
      await btn.click();
      await page.waitForTimeout(1500);
    }
    await page.screenshot({ path: 'screenshots/03-tree-packages.png', fullPage: true });
  });

  test('04 - Map view files', async ({ page, request }) => {
    await openProjectInPage(page, request);
    await page.click('button:has-text("Files")');
    await page.waitForTimeout(1500);
    await page.screenshot({ path: 'screenshots/04-map-files.png', fullPage: true });
  });

  test('05 - Map view symbols', async ({ page, request }) => {
    await openProjectInPage(page, request);
    await page.click('button:has-text("Symbols")');
    await page.waitForTimeout(1500);
    await page.screenshot({ path: 'screenshots/05-map-symbols.png', fullPage: true });
  });

  test('06 - Inspector with file selected', async ({ page, request }) => {
    await openProjectInPage(page, request);
    const file = page.locator('text=server.ts').first();
    if (await file.isVisible()) {
      await file.click();
      await page.waitForTimeout(800);
    }
    await page.screenshot({ path: 'screenshots/06-inspector.png', fullPage: true });
  });

  test('07 - Plans list', async ({ page }) => {
    await page.goto('/');
    await page.waitForTimeout(1000);
    await page.click('button:has-text("Plans")');
    await page.waitForTimeout(500);
    await page.screenshot({ path: 'screenshots/07-plans-list.png', fullPage: true });
  });

  test('08 - Plan with projection', async ({ page, request }) => {
    await request.post(`${API}/plans`, {
      data: {
        title: 'Add Auth System',
        description: 'JWT auth with middleware and protected routes',
        projectPath: PROJECT_PATH,
        tasks: [
          { description: 'Create auth middleware', affectedFiles: ['src/backend/middleware/auth.ts'] },
          { description: 'Add JWT utility', affectedFiles: ['src/backend/utils/jwt.ts'] },
          { description: 'Update server routes', affectedFiles: ['src/backend/server.ts'] },
        ],
      },
    });

    await openProjectInPage(page, request);
    await page.click('button:has-text("Plans")');
    await page.waitForTimeout(300);
    const plan = page.locator('text=Add Auth System').first();
    if (await plan.isVisible()) {
      await plan.click();
      await page.waitForTimeout(3000);
    }
    await page.screenshot({ path: 'screenshots/08-plan-projection.png', fullPage: true });
  });

  test('09 - Comments', async ({ page, request }) => {
    const plansRes = await request.get(`${API}/plans`);
    const plans = await plansRes.json();
    if (plans.length > 0) {
      const uid = plans[0].uid;
      await request.post(`${API}/comments`, { data: { targetType: 'plan', targetUid: uid, body: 'Use RS256 for better security', commentType: 'suggestion' } });
      await request.post(`${API}/comments`, { data: { targetType: 'plan', targetUid: uid, body: 'Approved, looks good', commentType: 'approval' } });
    }
    await page.goto('/');
    await page.waitForTimeout(1000);
    await page.click('button:has-text("Plans")');
    await page.waitForTimeout(300);
    const planItem = page.locator('.truncate.font-medium').first();
    if (await planItem.isVisible()) {
      await planItem.click();
      await page.waitForTimeout(1000);
    }
    await page.click('button:has-text("Comments")');
    await page.waitForTimeout(500);
    await page.screenshot({ path: 'screenshots/09-comments.png', fullPage: true });
  });

  test('10 - MCP guide', async ({ page }) => {
    await page.goto('/');
    await page.waitForTimeout(500);
    await page.click('button:has-text("Connect Agent")');
    await page.waitForTimeout(500);
    await page.screenshot({ path: 'screenshots/10-mcp-guide.png', fullPage: true });
  });

  test('11 - Create plan modal', async ({ page }) => {
    await page.goto('/');
    await page.waitForTimeout(1000);
    await page.click('button:has-text("Plans")');
    await page.waitForTimeout(300);
    const newBtn = page.locator('text=New').first();
    if (await newBtn.isVisible()) {
      await newBtn.click();
      await page.waitForTimeout(500);
    }
    await page.screenshot({ path: 'screenshots/11-create-plan.png', fullPage: true });
  });

  test('12 - Timeline', async ({ page }) => {
    await page.goto('/');
    await page.waitForTimeout(1000);
    await page.click('button:has-text("Timeline")');
    await page.waitForTimeout(500);
    await page.screenshot({ path: 'screenshots/12-timeline.png', fullPage: true });
  });
});
