/**
 * Marketing video capture — 1080p native.
 *
 * Run:
 *   npm run capture:videos
 *
 * Uses the EXACT same terminal workflow as screenshots.spec.ts.
 * MCP must be configured: `claude mcp add --transport sse codetrellis http://127.0.0.1:19432/sse`
 */

import { test } from '@playwright/test';
import path from 'node:path';
import fs from 'node:fs';
import { gotoWithProject, API, PROJECT_PATH } from '../helpers/setup';
import { cleanupDemoPlans } from './helpers/demo-data';
import { createMcpClient } from '../helpers/mcp-client';
import {
  spawnTerminal,
  killTerminal,
  injectPrompt,
} from '../live-agent/helpers/agent-harness';
import {
  createTempFixture,
  cleanupTempFixture,
} from '../live-agent/helpers/fixture-reset';

const FIXTURE_PATH = path.resolve(__dirname, '..', '..', 'tests', 'fixtures', 'sample-app');

const wait = (page: any, ms = 2000) => page.waitForTimeout(ms);

// ─────────────────────────────────────────────────
// Video 1: THE FULL EXPERIENCE
// ─────────────────────────────────────────────────

test.describe('Video: Full experience', () => {
  test.setTimeout(600_000);

  let tempFixture: string;
  let termId: string | null = null;

  test.beforeAll(async ({ request }) => {
    tempFixture = createTempFixture();
    await request.post(`${API}/project/scan`, {
      data: { projectPath: tempFixture },
    });
  });

  test.afterAll(async ({ request }) => {
    if (termId) await killTerminal(request, termId).catch(() => {});
    await cleanupDemoPlans(request);
    cleanupTempFixture(tempFixture);
  });

  test('create plan, execute, detect drift', async ({ page, request }) => {
    // ── Open project ──
    await gotoWithProject(page, { projectPath: tempFixture });
    await wait(page, 2000);

    // ── Spawn terminal — identical to screenshots ──
    termId = await spawnTerminal(request, {
      preset: 'shell',
      cwd: tempFixture,
    });
    await wait(page, 500);

    // Open terminal panel
    const terminalBtn = page.locator('button:has-text("Terminal")').last();
    await terminalBtn.click({ force: true });
    await wait(page, 1000);

    // Launch Claude Code
    await injectPrompt(request, termId, 'claude\n');
    await wait(page, 4000);

    // Accept workspace trust
    await injectPrompt(request, termId, '\r');
    await wait(page, 8000);

    // Dismiss security guide
    await injectPrompt(request, termId, '\r');
    await wait(page, 5000);

    // ── Ask Claude to create a plan ──
    await injectPrompt(request, termId, 'use codetrellis to create a plan for adding error handling and resilience to this project. include tasks for try-catch wrappers, error boundaries, retry logic, and structured logging');
    await wait(page, 500);
    await injectPrompt(request, termId, '\r');
    // Auto-accept Claude Code's "Do you want to proceed?" permission prompts
    // Claude asks before each MCP tool call — periodically press Enter to accept
    await wait(page, 15000);
    await injectPrompt(request, termId, '\r');
    await wait(page, 10000);
    await injectPrompt(request, termId, '\r');
    await wait(page, 10000);
    await injectPrompt(request, termId, '\r');
    await wait(page, 10000);
    await injectPrompt(request, termId, '\r');
    await wait(page, 15000);

    // ── Show the plan ──
    await page.getByRole('button', { name: 'Plans', exact: true }).first().click({ force: true });
    await wait(page, 1500);

    const planItems = page.locator('[class*="truncate"][class*="font-medium"]');
    if (await planItems.count() > 0) {
      await planItems.first().click({ force: true });
      await wait(page, 2000);
    }

    // Split view
    await page.keyboard.press('Meta+\\');
    await wait(page, 3000);

    // ── Ask Claude to execute a task ──
    await injectPrompt(request, termId, 'now pick up the first task from the plan and start implementing it');
    await wait(page, 500);
    await injectPrompt(request, termId, '\r');
    // Auto-accept permission prompts during task execution
    await wait(page, 15000);
    await injectPrompt(request, termId, '\r');
    await wait(page, 10000);
    await injectPrompt(request, termId, '\r');
    await wait(page, 10000);
    await injectPrompt(request, termId, '\r');
    await wait(page, 10000);
    await injectPrompt(request, termId, '\r');
    await wait(page, 15000);

    // ── Drift detection ──
    const plansRes = await request.get(`${API}/plans`);
    const plans = await plansRes.json();
    if (plans.length > 0) {
      const mcpClient = await createMcpClient();
      try {
        await mcpClient.callTool('register_session', {
          agent_type: 'claude-code',
          agent_model: 'claude-sonnet-4-20250514',
          project_path: tempFixture,
        });

        const dbFile = path.join(tempFixture, 'services/api/app/db.py');
        if (fs.existsSync(dbFile)) {
          fs.appendFileSync(dbFile, '\n# Unplanned: agent added health check\ndef health_check():\n    return {"status": "ok"}\n');
        }

        await mcpClient.callTool('detect_deviations', { plan_uid: plans[0].uid });
        await wait(page, 3000);

        const driftBtn = page.locator('button:has-text("Changes")').or(
          page.locator('button:has-text("Diff")'),
        ).first();
        if (await driftBtn.isVisible({ timeout: 3000 }).catch(() => false)) {
          await driftBtn.click({ force: true });
          await wait(page, 3000);
        }
      } finally {
        mcpClient.close();
      }
    }

    // ── Timeline ──
    const timelineBtn = page.locator('button:has-text("Timeline")').first();
    if (await timelineBtn.isVisible({ timeout: 3000 }).catch(() => false)) {
      await timelineBtn.click({ force: true });
      await wait(page, 4000);
    }

    await wait(page, 3000);
  });
});

// ─────────────────────────────────────────────────
// Video 2: UNDERSTAND ANY CODEBASE
// ─────────────────────────────────────────────────

test.describe('Video: Understand any codebase', () => {
  test.setTimeout(120_000);

  test('browse multi-language architecture', async ({ page, request }) => {
    await gotoWithProject(page, { projectPath: FIXTURE_PATH });
    await wait(page, 4000);

    await page.locator('button:has-text("Files")').first().click({ force: true });
    await wait(page, 4000);

    const apiNode = page.locator('text=api.ts').first();
    if (await apiNode.isVisible({ timeout: 3000 }).catch(() => false)) {
      await apiNode.click({ force: true });
      await wait(page, 3000);
    }

    await page.locator('button:has-text("Symbols")').first().click({ force: true });
    await wait(page, 4000);

    await page.locator('button:has-text("Clusters")').first().click({ force: true });
    await wait(page, 3000);

    await wait(page, 2000);
  });
});

// ─────────────────────────────────────────────────
// Video 3: PLAN BEFORE YOU BUILD
// ─────────────────────────────────────────────────

test.describe('Video: Plan before you build', () => {
  test.setTimeout(600_000);

  let termId: string | null = null;

  test.afterAll(async ({ request }) => {
    if (termId) await killTerminal(request, termId).catch(() => {});
    await cleanupDemoPlans(request);
  });

  test('refine a plan with Claude Code', async ({ page, request }) => {
    // ── Open project with graph ──
    await gotoWithProject(page);
    await wait(page, 2000);

    // ── Seed a starter plan ──
    const planRes = await request.post(`${API}/plans`, {
      data: {
        title: 'Add JWT Authentication',
        description: 'JWT-based auth with RS256 signing, refresh tokens, and role-based middleware.',
        projectPath: PROJECT_PATH,
      },
    });
    const plan = await planRes.json();

    await request.post(`${API}/plans/${plan.uid}/phases`, {
      data: { title: 'Phase 1: Auth infrastructure', phase_number: 1 },
    });
    await request.post(`${API}/plans/${plan.uid}/phases`, {
      data: { title: 'Phase 2: Protected routes', phase_number: 2 },
    });
    await request.post(`${API}/plans/${plan.uid}/items`, {
      data: { kind: 'action', title: 'Create JWT token service with RS256', status: 'done', template: 'action', fileSpecs: [{ path: 'src/backend/services/auth-service.ts', action: 'create' }] },
    });
    await request.post(`${API}/plans/${plan.uid}/items`, {
      data: { kind: 'action', title: 'Add auth middleware', status: 'pending', template: 'action', fileSpecs: [{ path: 'src/backend/middleware/auth.ts', action: 'create' }] },
    });
    await request.post(`${API}/plans/${plan.uid}/items`, {
      data: { kind: 'action', title: 'Create login and register endpoints', status: 'pending', template: 'action', fileSpecs: [{ path: 'src/backend/routes/auth.ts', action: 'create' }] },
    });

    // ── Show the plan ──
    await page.getByRole('button', { name: 'Plans', exact: true }).first().click({ force: true });
    await wait(page, 1000);
    await page.locator('text=Add JWT Authentication').first().click({ force: true });
    await wait(page, 3000);

    // Projection overlay
    const plannedBtn = page.locator('button:has-text("Planned")');
    if (await plannedBtn.isVisible({ timeout: 3000 }).catch(() => false)) {
      await plannedBtn.click({ force: true });
      await wait(page, 3000);
    }

    // ── Spawn terminal — identical to screenshots ──
    termId = await spawnTerminal(request, {
      preset: 'shell',
      cwd: PROJECT_PATH,
    });
    await wait(page, 500);

    // Open terminal panel
    const terminalBtn = page.locator('button:has-text("Terminal")').last();
    await terminalBtn.click({ force: true });
    await wait(page, 1000);

    // Launch Claude Code
    await injectPrompt(request, termId, 'claude\n');
    await wait(page, 4000);

    // Accept workspace trust
    await injectPrompt(request, termId, '\r');
    await wait(page, 8000);

    // Dismiss security guide
    await injectPrompt(request, termId, '\r');
    await wait(page, 5000);

    // ── Ask Claude to refine the plan ──
    await injectPrompt(request, termId, 'read the JWT Authentication plan in codetrellis and add tasks for refresh token rotation, rate limiting on auth endpoints, and integration tests');
    await wait(page, 500);
    await injectPrompt(request, termId, '\r');
    // Auto-accept permission prompts during plan refinement
    await wait(page, 15000);
    await injectPrompt(request, termId, '\r');
    await wait(page, 10000);
    await injectPrompt(request, termId, '\r');
    await wait(page, 10000);
    await injectPrompt(request, termId, '\r');
    await wait(page, 10000);
    await injectPrompt(request, termId, '\r');
    await wait(page, 15000);

    // ── Show updated plan ──
    await page.getByRole('button', { name: 'Plans', exact: true }).first().click({ force: true });
    await wait(page, 1000);
    await page.locator('text=Add JWT Authentication').first().click({ force: true });
    await wait(page, 3000);

    // Split view
    await page.keyboard.press('Meta+\\');
    await wait(page, 4000);

    await wait(page, 2000);
  });
});
