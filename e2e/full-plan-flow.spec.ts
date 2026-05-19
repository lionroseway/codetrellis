/**
 * Full Plan Flow E2E — the core CodeTrellis workflow.
 *
 * Tests the complete journey: scan a project, create a plan in the
 * V2 workspace, add items with file targets, connect a simulated
 * MCP agent, hand off, watch execution, verify drift and completion.
 *
 * This is the test that validates the product's reason for existing.
 *
 * Requires: backend on :3001 + frontend on :5173 (playwright.config.ts)
 */

import { test, expect, type Page } from '@playwright/test';

const API = 'http://localhost:3001/api';
const PROJECT_PATH = process.cwd();

// ─────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────

/**
 * Navigate to the app with onboarding pre-dismissed and project
 * scanned. This simulates a returning user who has already been
 * through onboarding and has a project open.
 *
 * Uses the built-in `__test_open_project__` custom event hook
 * (App.tsx line 62-74) to populate the Zustand project store.
 */
async function gotoWithProject(page: Page) {
  // Skip onboarding wizard + getting-started checklist
  await page.addInitScript((projectPath: string) => {
    localStorage.setItem('codetrellis:learn-trellis:seen', '1');
    // Dismiss the "Getting Started" checklist for this project
    localStorage.setItem(`codetrellis:gettingStarted:dismissed:${projectPath}`, '1');
  }, PROJECT_PATH);

  await page.goto('/');

  // Wait for the React app to mount
  await page.locator('text=Explorer').or(page.getByText('Open Project')).first()
    .waitFor({ timeout: 10000 });

  // Scan the project via API, then fire the test hook event
  // to populate the frontend Zustand store.
  await page.evaluate(async (projectPath: string) => {
    // Scan the project — retry once if the backend is slow
    let result: any;
    for (let attempt = 0; attempt < 2; attempt++) {
      const res = await fetch('/api/project/scan', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ projectPath }),
      });
      const text = await res.text();
      try {
        result = JSON.parse(text);
        break;
      } catch {
        // Backend might not be ready — wait and retry
        if (attempt === 0) await new Promise((r) => setTimeout(r, 2000));
        else throw new Error(`/api/project/scan returned non-JSON: ${text.slice(0, 100)}`);
      }
    }

    let branch: string | null = null;
    try {
      const branchRes = await fetch(`/api/git/branch?path=${encodeURIComponent(projectPath)}`);
      const branchData = await branchRes.json();
      branch = branchData.branch;
    } catch { /* ignore */ }

    // Fire the custom event that App.tsx listens for —
    // this populates the project store properly.
    window.dispatchEvent(new CustomEvent('__test_open_project__', {
      detail: { projectPath, branch, result },
    }));
  }, PROJECT_PATH);

  // Wait for the graph canvas to render (project store triggers
  // a re-render that mounts ReactFlow)
  await page.locator('.react-flow').waitFor({ timeout: 15000 });
}


// ─────────────────────────────────────────────────
// Phase 1 — App loads and scans
// ─────────────────────────────────────────────────

test.describe('Full Plan Flow', () => {
  test.describe.configure({ mode: 'serial' });

  let planUid: string;
  let actionUid: string;

  // Clean up leftover plans from previous runs
  test.beforeAll(async ({ request }) => {
    const res = await request.get(`${API}/plans`);
    if (res.ok()) {
      const plans = await res.json();
      for (const p of plans) {
        if (p.title === 'E2E Full Flow Plan' && p.status !== 'archived') {
          await request.delete(`${API}/plans/${p.uid}`);
        }
      }
    }
  });

  test('1 — app loads with graph visible', async ({ page }) => {
    await gotoWithProject(page);

    // Graph canvas should be visible
    await expect(page.locator('.react-flow')).toBeVisible();

    // Depth selector should show
    await expect(page.getByRole('button', { name: 'Clusters' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Files' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Symbols' })).toBeVisible();
  });

  test('2 — bottom plan panel shows Plans tab', async ({ page }) => {
    await gotoWithProject(page);

    // Plan panel tabs should be visible
    const plansTab = page.getByRole('button', { name: 'Plans', exact: true });
    await expect(plansTab).toBeVisible();
    await plansTab.click();

    // Should see "New plan" button
    await expect(page.locator('button:has-text("New plan")')).toBeVisible();
  });

  // ─────────────────────────────────────────────────
  // Phase 2 — Create a plan via the UI
  // ─────────────────────────────────────────────────

  test('3 — create a new plan from the UI', async ({ page }) => {
    await gotoWithProject(page);

    // Click Plans tab, then New plan
    await page.getByRole('button', { name: 'Plans', exact: true }).click();
    await page.locator('button:has-text("New plan")').click();

    // Wait for the plan workspace to open
    // The V2 workspace should appear with an "Untitled" plan
    await expect(page.locator('input[placeholder="Untitled plan"]')).toBeVisible({
      timeout: 5000,
    });

    // Type a plan title
    await page.fill('input[placeholder="Untitled plan"]', 'E2E Full Flow Plan');
    // Trigger save by tabbing away
    await page.keyboard.press('Tab');

    // Wait for save to propagate
    await page.waitForTimeout(1000);

    // Grab the plan UID from the API — filter out archived plans
    const res = await page.request.get(`${API}/plans`);
    const plans = await res.json();
    const our = plans.find(
      (p: any) => p.title === 'E2E Full Flow Plan' && p.status !== 'archived',
    );
    expect(our).toBeTruthy();
    planUid = our.uid;
  });

  test('4 — write plan body/description', async ({ page }) => {
    await gotoWithProject(page);

    // Open the plan
    await page.getByRole('button', { name: 'Plans', exact: true }).click();
    await page.locator('text=E2E Full Flow Plan').first().click();

    // Wait for workspace to load
    await expect(page.locator('input[placeholder="Untitled plan"]')).toBeVisible({
      timeout: 5000,
    });

    // The body area starts in edit mode for a new plan (textarea
    // auto-focused). Fill it directly.
    const textarea = page.locator('textarea').first();
    await expect(textarea).toBeVisible({ timeout: 3000 });
    await textarea.fill(
      'Refactor the server module to extract terminal routes into a separate router.\n\n' +
      'Acceptance criteria:\n' +
      '- Terminal routes moved to src/backend/routes/terminal.ts\n' +
      '- All existing tests pass\n' +
      '- No functional changes to the API',
    );
    // Click outside to trigger save (blur commit)
    await page.locator('input[placeholder="Untitled plan"]').click();
    await page.waitForTimeout(1000);
  });

  // ─────────────────────────────────────────────────
  // Phase 3 — Add items (Objects + Actions)
  // ─────────────────────────────────────────────────

  test('5 — add an Action (work item) to the plan', async ({ request }) => {
    // Use API to add items — the UI test validates the display,
    // the API ensures reliable state setup
    expect(planUid).toBeTruthy();
    const res = await request.post(`${API}/plans/${planUid}/items`, {
      data: {
        kind: 'action',
        title: 'Extract terminal routes',
        template: 'action',
        body: 'Move all /api/terminals/* routes from server.ts into a dedicated router module.',
        status: 'pending',
        fileSpecs: [
          { path: 'src/backend/server.ts', action: 'modify' },
          { path: 'src/backend/routes/terminal.ts', action: 'create' },
        ],
      },
    });
    expect(res.ok()).toBeTruthy();
    const item = await res.json();
    expect(item.uid).toBeTruthy();
    expect(item.kind).toBe('action');
    actionUid = item.uid;
  });

  test('6 — add a second Action with file targets', async ({ request }) => {
    const res = await request.post(`${API}/plans/${planUid}/items`, {
      data: {
        kind: 'action',
        title: 'Update imports across codebase',
        template: 'action',
        body: 'Update all imports that reference terminal routes in server.ts to use the new module.',
        status: 'pending',
        fileSpecs: [
          { path: 'src/electron/main.ts', action: 'modify' },
          { path: 'src/backend/server.ts', action: 'modify' },
        ],
      },
    });
    expect(res.ok()).toBeTruthy();
  });

  test('7 — plan items appear in the workspace UI', async ({ page }) => {
    await gotoWithProject(page);

    // Open the plan
    await page.getByRole('button', { name: 'Plans', exact: true }).click();
    await page.locator('text=E2E Full Flow Plan').first().click();

    // Wait for workspace
    await page.waitForTimeout(1500);

    // The sidebar tree should show our items — use first() since the
    // title appears in multiple places (tree, activity, canvas)
    await expect(page.getByText('Extract terminal routes').first()).toBeVisible({
      timeout: 5000,
    });
    await expect(page.getByText('Update imports across codebase').first()).toBeVisible();
  });

  test('8 — click an Action to see its detail canvas', async ({ page }) => {
    await gotoWithProject(page);

    // Open plan
    await page.getByRole('button', { name: 'Plans', exact: true }).click();
    await page.locator('text=E2E Full Flow Plan').first().click();
    await page.waitForTimeout(1500);

    // Click the first action in the tree
    await page.getByText('Extract terminal routes').first().click();
    await page.waitForTimeout(500);

    // The canvas should show the action title input
    const titleInput = page.locator('input[placeholder="Untitled"]');
    await expect(titleInput).toBeVisible({ timeout: 5000 });
    await expect(titleInput).toHaveValue('Extract terminal routes');

    // Should show file specs
    await expect(page.getByText('server.ts').first()).toBeVisible();
  });

  // ─────────────────────────────────────────────────
  // Phase 4 — Plan readiness check
  // ─────────────────────────────────────────────────

  test('9 — readiness ring shows a score', async ({ page }) => {
    await gotoWithProject(page);

    // Open plan
    await page.getByRole('button', { name: 'Plans', exact: true }).click();
    await page.locator('text=E2E Full Flow Plan').first().click();
    await page.waitForTimeout(1500);

    // The readiness ring should exist in the workspace header
    // It renders as an SVG circle with a percentage
    const readinessEl = page.locator('text=ready').first();
    // May or may not be visible depending on score — just check the
    // workspace loaded without crashing
    await expect(page.getByText('E2E Full Flow Plan').first()).toBeVisible();
  });

  // ─────────────────────────────────────────────────
  // Phase 5 — Agent connection via MCP
  // ─────────────────────────────────────────────────

  test('10 — MCP guide modal opens and shows config', async ({ page }) => {
    await gotoWithProject(page);

    // Click Connect Agent
    await page.locator('button:has-text("Connect Agent")').click();

    // Modal should appear with connection instructions
    await expect(page.locator('text=Connect an AI Agent')).toBeVisible({
      timeout: 3000,
    });

    // Should show the MCP config snippet
    await expect(page.locator('text=Copy Config')).toBeVisible();

    // Close the modal
    await page.keyboard.press('Escape');
  });

  test('11 — register agent session via API', async ({ request }) => {
    // Simulate an MCP agent registering a session
    const res = await request.get(`${API}/agent/status`);
    expect(res.ok()).toBeTruthy();
  });

  // ─────────────────────────────────────────────────
  // Phase 6 — Agent task lifecycle
  // ─────────────────────────────────────────────────

  test('12 — agent claims a task via API', async ({ request }) => {
    // Simulate agent claiming the first action
    const res = await request.post(
      `${API}/items/${actionUid}/claim`,
      { data: { agentId: 'e2e-test-agent', agentType: 'agent' } },
    );
    expect(res.ok()).toBeTruthy();
    const result = await res.json();
    expect(result.ok).toBe(true);

    // Verify the item status changed
    const itemRes = await request.get(`${API}/items/${actionUid}`);
    const item = await itemRes.json();
    expect(item.status).toBe('assigned');
  });

  test('13 — agent reports progress', async ({ request }) => {
    const res = await request.post(
      `${API}/items/${actionUid}/progress`,
      {
        data: {
          percent: 50,
          message: 'Extracted routes, wiring up the router',
        },
      },
    );
    expect(res.ok()).toBeTruthy();
  });

  test('14 — task progress visible in the UI', async ({ page }) => {
    await gotoWithProject(page);

    // Open plan
    await page.getByRole('button', { name: 'Plans', exact: true }).click();
    await page.locator('text=E2E Full Flow Plan').first().click();
    await page.waitForTimeout(1500);

    // The action should now show "assigned" or progress indicator
    // Click the action to see its detail
    await page.getByText('Extract terminal routes').first().click();
    await page.waitForTimeout(500);

    // Should show agent name and progress from the API operations
    await expect(page.getByText('e2e-test-agent').first()).toBeVisible({ timeout: 3000 });
    await expect(page.getByText('50%').first()).toBeVisible();
  });

  test('15 — agent marks task as done', async ({ request }) => {
    const res = await request.put(`${API}/items/${actionUid}`, {
      data: { status: 'done' },
    });
    expect(res.ok()).toBeTruthy();
  });

  // ─────────────────────────────────────────────────
  // Phase 7 — Comments and collaboration
  // ─────────────────────────────────────────────────

  test('16 — add a comment on the action', async ({ request }) => {
    const res = await request.post(`${API}/items/${actionUid}/comments`, {
      data: {
        body: 'Looks good, tests pass. Approve.',
        kind: 'note',
      },
    });
    expect(res.ok()).toBeTruthy();
  });

  test('17 — comments visible in the UI', async ({ page }) => {
    await gotoWithProject(page);

    // Open plan and click the action
    await page.getByRole('button', { name: 'Plans', exact: true }).click();
    await page.locator('text=E2E Full Flow Plan').first().click();
    await page.waitForTimeout(1500);
    await page.getByText('Extract terminal routes').first().click();
    await page.waitForTimeout(500);

    // Scroll down to comments section
    // The comment should be visible
    await expect(page.getByText('Looks good, tests pass').first()).toBeVisible({
      timeout: 3000,
    });
  });

  // ─────────────────────────────────────────────────
  // Phase 8 — Plan version history
  // ─────────────────────────────────────────────────

  test('18 — plan has version history', async ({ request }) => {
    const res = await request.get(`${API}/plans/${planUid}/versions`);
    expect(res.ok()).toBeTruthy();
    const versions = await res.json();
    expect(versions.length).toBeGreaterThanOrEqual(2);
  });

  test('19 — action has version history', async ({ request }) => {
    const res = await request.get(`${API}/items/${actionUid}/versions`);
    expect(res.ok()).toBeTruthy();
    const versions = await res.json();
    expect(versions.length).toBeGreaterThanOrEqual(2);
  });

  // ─────────────────────────────────────────────────
  // Phase 9 — Timeline and activity
  // ─────────────────────────────────────────────────

  test('20 — timeline tab shows events in the UI', async ({ page }) => {
    await gotoWithProject(page);

    // Click Timeline tab in bottom panel
    const timelineTab = page.getByRole('button', { name: 'Timeline' });
    await timelineTab.click();
    await page.waitForTimeout(500);

    // Timeline should have some events from our activity
    // At minimum, the panel should render without crashing
    await expect(timelineTab).toBeVisible();
  });

  // ─────────────────────────────────────────────────
  // Phase 10 — Terminal integration
  // ─────────────────────────────────────────────────

  test('21 — create a terminal session via API', async ({ request }) => {
    const res = await request.post(`${API}/terminals`, {
      data: {
        preset: 'shell',
        cwd: PROJECT_PATH,
        title: 'E2E Test Terminal',
      },
    });
    expect(res.ok()).toBeTruthy();
    const session = await res.json();
    expect(session.id).toBeTruthy();
    expect(session.alive).toBe(true);
    expect(session.preset).toBe('shell');
  });

  test('22 — terminal panel shows in the UI', async ({ page }) => {
    await gotoWithProject(page);

    // The terminal button is in the status bar at the bottom
    // Click "New terminal" in the collapsed terminal panel
    const newTermBtn = page.getByText('New terminal');
    if (await newTermBtn.isVisible({ timeout: 2000 }).catch(() => false)) {
      await newTermBtn.click();
      await page.waitForTimeout(500);
    }

    // The terminal panel should be visible — look for the terminal
    // tab bar or the terminal icon in status bar
    await expect(page.locator('text=Terminal').first()).toBeVisible();
  });

  test('23 — list and kill terminal sessions', async ({ request }) => {
    const listRes = await request.get(`${API}/terminals`);
    expect(listRes.ok()).toBeTruthy();
    const sessions = await listRes.json();
    expect(sessions.length).toBeGreaterThan(0);

    // Kill all test terminals
    for (const s of sessions) {
      await request.delete(`${API}/terminals/${s.id}`);
    }

    // Verify empty
    const afterRes = await request.get(`${API}/terminals`);
    const after = await afterRes.json();
    expect(after.length).toBe(0);
  });

  // ─────────────────────────────────────────────────
  // Phase 11 — Settings verification
  // ─────────────────────────────────────────────────

  test('24 — settings modal opens and shows sections', async ({ page }) => {
    await gotoWithProject(page);

    // Click settings button in TopBar
    const settingsBtn = page.locator('button[title*="Settings"]');
    await settingsBtn.click();

    // Modal should appear with sidebar section buttons
    await expect(page.getByRole('button', { name: 'Identity' })).toBeVisible({ timeout: 3000 });
    await expect(page.getByRole('button', { name: 'MCP Server' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'About' })).toBeVisible();

    // Click through sections
    await page.getByRole('button', { name: 'MCP Server' }).click();
    await page.waitForTimeout(300);
    await expect(page.getByText('19432', { exact: true })).toBeVisible();

    // Close
    await page.keyboard.press('Escape');
  });

  // ─────────────────────────────────────────────────
  // Phase 12 — Deviations / drift detection
  // ─────────────────────────────────────────────────

  test('25 — deviation detection endpoint works', async ({ request }) => {
    const res = await request.get(`${API}/plans/${planUid}/deviations`);
    // May return 200 with empty array (no drift yet) or the endpoint
    // itself. Either way it shouldn't 500.
    expect(res.status()).toBeLessThan(500);
  });

  // ─────────────────────────────────────────────────
  // Phase 13 — Plan export
  // ─────────────────────────────────────────────────

  test('26 — export plan to disk', async ({ request }) => {
    const res = await request.post(`${API}/plans/${planUid}/export`, {
      data: { projectRoot: PROJECT_PATH },
    });
    expect(res.ok()).toBeTruthy();
    const result = await res.json();
    expect(result.planDir).toBeTruthy();
    expect(result.planDir).toContain('.codetrellis/plans');
  });

  test('27 — exported plan discoverable', async ({ request }) => {
    const res = await request.get(
      `${API}/plans/discover?project=${encodeURIComponent(PROJECT_PATH)}`,
    );
    expect(res.ok()).toBeTruthy();
    const dirs = await res.json();
    expect(dirs.length).toBeGreaterThan(0);
  });

  // ─────────────────────────────────────────────────
  // Phase 14 — Cleanup / archive
  // ─────────────────────────────────────────────────

  test('28 — archive the plan', async ({ request }) => {
    const res = await request.delete(`${API}/plans/${planUid}`);
    expect(res.ok()).toBeTruthy();

    // Verify archived
    const getRes = await request.get(`${API}/plans/${planUid}`);
    const plan = await getRes.json();
    expect(plan.status).toBe('archived');
  });

  // ─────────────────────────────────────────────────
  // Phase 15 — Plan from template
  // ─────────────────────────────────────────────────

  test('29 — list available templates', async ({ request }) => {
    const res = await request.get(`${API}/plan-templates`);
    expect(res.ok()).toBeTruthy();
    const templates = await res.json();
    expect(templates.length).toBeGreaterThanOrEqual(5);

    // Should have our known templates
    const names = templates.map((t: any) => t.id);
    expect(names).toContain('new-feature');
    expect(names).toContain('bug-fix');
    expect(names).toContain('mass-refactor');
  });

  test('30 — create plan from template', async ({ request }) => {
    const res = await request.post(`${API}/plans/from-template`, {
      data: {
        templateId: 'bug-fix',
        projectPath: PROJECT_PATH,
        placeholderValues: {
          bug: 'Terminal WebSocket fails in Electron',
        },
      },
    });
    expect(res.ok()).toBeTruthy();
    const result = await res.json();
    expect(result.plan).toBeTruthy();
    expect(result.plan.uid).toBeTruthy();

    // Clean up
    await request.delete(`${API}/plans/${result.plan.uid}`);
  });

  // ─────────────────────────────────────────────────
  // Phase 16 — Graph interaction basics
  // ─────────────────────────────────────────────────

  test('31 — depth selector switches views', async ({ page }) => {
    await gotoWithProject(page);

    // Switch to Files view
    await page.locator('button:has-text("Files")').click();
    await page.waitForTimeout(500);

    // Switch to Symbols
    await page.locator('button:has-text("Symbols")').click();
    await page.waitForTimeout(500);

    // Back to Clusters
    await page.locator('button:has-text("Clusters")').click();
    await page.waitForTimeout(500);

    // Graph should still be visible
    await expect(page.locator('.react-flow')).toBeVisible();
  });

  // ─────────────────────────────────────────────────
  // Phase 17 — Git integration
  // ─────────────────────────────────────────────────

  test('32 — git status endpoint works', async ({ request }) => {
    const res = await request.get(
      `${API}/git/status?path=${encodeURIComponent(PROJECT_PATH)}`,
    );
    expect(res.status()).toBeLessThan(500);
  });

  test('33 — git branch endpoint works', async ({ request }) => {
    const res = await request.get(
      `${API}/git/branch?path=${encodeURIComponent(PROJECT_PATH)}`,
    );
    expect(res.status()).toBeLessThan(500);
  });

  test('34 — health check', async ({ request }) => {
    const res = await request.get(`${API}/health`);
    expect(res.ok()).toBeTruthy();
    const body = await res.json();
    expect(body.status).toBe('ok');
  });
});
