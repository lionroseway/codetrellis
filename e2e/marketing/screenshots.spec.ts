/**
 * Marketing screenshot capture — 4K (3840×2160).
 *
 * Run:
 *   npm run capture:screenshots
 *
 * Outputs to marketing-assets/screenshots/ organised by value prop:
 *   understand/      — Graph, inspector, cross-language
 *   plan/            — Plans, projection, spec docs, comments
 *   keep-on-track/   — Terminal, agent monitoring, drift, timeline
 *   onboarding/      — Welcome, MCP guide, settings
 */

import { test } from '@playwright/test';
import path from 'node:path';
import fs from 'node:fs';
import { gotoWithProject, gotoWelcome, API, PROJECT_PATH } from '../helpers/setup';
import { seedAuthPlan, seedRefactorPlan, cleanupDemoPlans, type DemoPlan } from './helpers/demo-data';
import { createMcpClient } from '../helpers/mcp-client';
import {
  spawnTerminal,
  killTerminal,
  injectPrompt,
} from '../live-agent/helpers/agent-harness';
import {
  openTempFixture,
  cleanupTempFixture,
} from '../live-agent/helpers/fixture-reset';

const FIXTURE_PATH = path.resolve(__dirname, '..', '..', 'tests', 'fixtures', 'sample-app');
const OUT = 'marketing-assets/screenshots';

const wait = (page: any, ms = 2000) => page.waitForTimeout(ms);

// ═════════════════════════════════════════════════
// UNDERSTAND — graph views, inspector, cross-language
// ═════════════════════════════════════════════════

test.describe('understand/', () => {
  test.setTimeout(90_000);

  test.beforeAll(async ({ request }) => {
    await request.post(`${API}/project/scan`, {
      data: { projectPath: PROJECT_PATH },
    });
  });

  test('hero-packages — full dependency graph at cluster level', async ({ page }) => {
    await gotoWithProject(page);
    await wait(page, 3000);
    await page.screenshot({ path: `${OUT}/understand/hero-packages.png`, fullPage: false });
  });

  test('graph-files — file-level detail', async ({ page }) => {
    await gotoWithProject(page);
    await wait(page, 2000);
    await page.locator('button:has-text("Files")').first().click();
    await wait(page, 3000);
    await page.screenshot({ path: `${OUT}/understand/graph-files.png`, fullPage: false });
  });

  test('graph-symbols — symbol-level graph', async ({ page }) => {
    await gotoWithProject(page);
    await wait(page, 2000);
    await page.locator('button:has-text("Symbols")').first().click();
    await wait(page, 3000);
    await page.screenshot({ path: `${OUT}/understand/graph-symbols.png`, fullPage: false });
  });

  test('inspector — file selected with inspector panel', async ({ page }) => {
    await gotoWithProject(page);
    await wait(page, 2000);
    await page.locator('button:has-text("Files")').first().click();
    await wait(page, 2000);
    const serverNode = page.locator('text=server.ts').first();
    if (await serverNode.isVisible({ timeout: 5000 }).catch(() => false)) {
      await serverNode.click();
      await wait(page, 1500);
    }
    await page.screenshot({ path: `${OUT}/understand/inspector.png`, fullPage: false });
  });

  test('cross-system-graph — TS + Python + SQL in one graph', async ({ page, request }) => {
    await request.post(`${API}/project/scan`, {
      data: { projectPath: FIXTURE_PATH },
    });
    await gotoWithProject(page, { projectPath: FIXTURE_PATH });
    await wait(page, 3000);
    await page.screenshot({ path: `${OUT}/understand/cross-system-graph.png`, fullPage: false });
  });

  test('file-imports — import edges across languages', async ({ page, request }) => {
    await request.post(`${API}/project/scan`, {
      data: { projectPath: FIXTURE_PATH },
    });
    await gotoWithProject(page, { projectPath: FIXTURE_PATH });
    await wait(page, 2000);
    await page.locator('button:has-text("Files")').first().click();
    await wait(page, 3000);
    await page.screenshot({ path: `${OUT}/understand/file-imports.png`, fullPage: false });
  });

  test('symbols-multi-language — Python + TypeScript symbols', async ({ page, request }) => {
    await request.post(`${API}/project/scan`, {
      data: { projectPath: FIXTURE_PATH },
    });
    await gotoWithProject(page, { projectPath: FIXTURE_PATH });
    await wait(page, 2000);
    await page.locator('button:has-text("Symbols")').first().click();
    await wait(page, 3000);
    await page.screenshot({ path: `${OUT}/understand/symbols-multi-language.png`, fullPage: false });
  });
});

// ═════════════════════════════════════════════════
// PLAN — plan workspace, projection, spec docs, comments
// ═════════════════════════════════════════════════

test.describe('plan/', () => {
  test.setTimeout(120_000);

  let authPlan: DemoPlan;

  test.beforeAll(async ({ request }) => {
    await cleanupDemoPlans(request);
    await request.post(`${API}/project/scan`, {
      data: { projectPath: PROJECT_PATH },
    });
    authPlan = await seedAuthPlan(request, PROJECT_PATH);
  });

  test.afterAll(async ({ request }) => {
    await cleanupDemoPlans(request);
  });

  test('workspace — plan with tasks, phases, and spec doc', async ({ page }) => {
    await gotoWithProject(page);
    await wait(page, 2000);
    await page.getByRole('button', { name: 'Plans', exact: true }).first().click();
    await wait(page, 500);
    await page.locator('text=Add JWT Authentication').first().click();
    await wait(page, 2000);
    await page.screenshot({ path: `${OUT}/plan/workspace.png`, fullPage: false });
  });

  test('projection — planned files highlighted on graph', async ({ page }) => {
    await gotoWithProject(page);
    await wait(page, 2000);
    await page.getByRole('button', { name: 'Plans', exact: true }).first().click();
    await wait(page, 500);
    await page.locator('text=Add JWT Authentication').first().click();
    await wait(page, 2000);

    const plannedBtn = page.locator('button:has-text("Planned")');
    if (await plannedBtn.isVisible({ timeout: 3000 }).catch(() => false)) {
      await plannedBtn.click();
      await wait(page, 2000);
    }
    await page.screenshot({ path: `${OUT}/plan/projection.png`, fullPage: false });
  });

  test('split-view — plan + graph side by side', async ({ page }) => {
    await gotoWithProject(page);
    await wait(page, 2000);
    await page.getByRole('button', { name: 'Plans', exact: true }).first().click();
    await wait(page, 500);
    await page.locator('text=Add JWT Authentication').first().click();
    await wait(page, 2000);
    await page.keyboard.press('Meta+\\');
    await wait(page, 2000);
    await page.screenshot({ path: `${OUT}/plan/split-view.png`, fullPage: false });
  });

  test('comments — collaboration thread on a plan', async ({ page }) => {
    await gotoWithProject(page);
    await wait(page, 2000);
    await page.getByRole('button', { name: 'Plans', exact: true }).first().click();
    await wait(page, 500);
    await page.locator('text=Add JWT Authentication').first().click();
    await wait(page, 1500);
    const commentsBtn = page.locator('button:has-text("Comments")').first();
    if (await commentsBtn.isVisible({ timeout: 3000 }).catch(() => false)) {
      await commentsBtn.click({ force: true });
      await wait(page, 1000);
    }
    await page.screenshot({ path: `${OUT}/plan/comments.png`, fullPage: false });
  });

  test('create-plan — new plan modal', async ({ page }) => {
    await gotoWithProject(page);
    await wait(page, 2000);
    await page.getByRole('button', { name: 'Plans', exact: true }).first().click();
    await wait(page, 500);
    const newBtn = page.locator('text=New').first();
    if (await newBtn.isVisible({ timeout: 3000 }).catch(() => false)) {
      await newBtn.click();
      await wait(page, 1000);
    }
    await page.screenshot({ path: `${OUT}/plan/create-plan.png`, fullPage: false });
  });

  test('workspace-cross-language — plan on multi-language project', async ({ page, request }) => {
    await request.post(`${API}/project/scan`, {
      data: { projectPath: FIXTURE_PATH },
    });
    const refactorPlan = await seedRefactorPlan(request, FIXTURE_PATH);

    await gotoWithProject(page, { projectPath: FIXTURE_PATH });
    await wait(page, 2000);
    await page.getByRole('button', { name: 'Plans', exact: true }).first().click();
    await wait(page, 500);
    await page.locator('text=Refactor Database Layer').first().click();
    await wait(page, 2000);
    await page.screenshot({ path: `${OUT}/plan/workspace-cross-language.png`, fullPage: false });
  });
});

// ═════════════════════════════════════════════════
// KEEP ON TRACK — terminal, agent monitoring, drift, timeline
// ═════════════════════════════════════════════════

test.describe('keep-on-track/', () => {
  test.setTimeout(180_000);

  let tempFixture: string;
  let termId: string | null = null;
  let termId2: string | null = null;

  test.beforeAll(async ({ request }) => {
    tempFixture = await openTempFixture();
    await request.post(`${API}/project/scan`, {
      data: { projectPath: tempFixture },
    });
  });

  test.afterAll(async ({ request }) => {
    if (termId) await killTerminal(request, termId).catch(() => {});
    if (termId2) await killTerminal(request, termId2).catch(() => {});
    await cleanupDemoPlans(request);
    cleanupTempFixture(tempFixture);
  });

  test('terminal-agent — Claude Code actively working in terminal', async ({ page, request }) => {
    await gotoWithProject(page, { projectPath: tempFixture });
    await wait(page, 2000);

    // Spawn a shell terminal, then launch Claude Code with MCP connected to CodeTrellis
    termId = await spawnTerminal(request, {
      preset: 'shell',
      cwd: tempFixture,
    });
    await wait(page, 500);

    // Open terminal panel
    const terminalBtn = page.locator('button:has-text("Terminal")').last();
    await terminalBtn.click({ force: true });
    await wait(page, 1000);

    // Launch Claude Code (MCP server configured globally via `claude mcp add`)
    await injectPrompt(request, termId, 'claude\n');
    await wait(page, 4000); // Wait for trust dialog

    // Accept workspace trust
    await injectPrompt(request, termId, '\r');
    await wait(page, 8000); // Wait for Claude Code to fully init + MCP handshake

    // Dismiss any follow-up prompts (security guide etc.)
    await injectPrompt(request, termId, '\r');
    await wait(page, 5000);

    // Type a CodeTrellis-specific prompt, then submit with Enter
    await injectPrompt(request, termId, 'use codetrellis to create a plan for adding authentication to this project');
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
    await wait(page, 15000);

    await page.screenshot({ path: `${OUT}/keep-on-track/terminal-agent.png`, fullPage: false });
  });

  test('agent-plan-building — agent connected, building a plan live', async ({ page, request }) => {
    await gotoWithProject(page, { projectPath: tempFixture });
    await wait(page, 2000);

    const mcpClient = await createMcpClient();
    try {
      await mcpClient.callTool('register_session', {
        agent_type: 'claude-code',
        agent_model: 'claude-sonnet-4-20250514',
        project_path: tempFixture,
      });

      const planResult = await mcpClient.callTool('create_plan', {
        tasks: [],
        title: 'Add Error Handling & Resilience',
        project_path: tempFixture,
      });
      const planUid = JSON.parse(planResult.content?.[0]?.text || '{}').uid;
      await mcpClient.callTool('set_active_plan', { plan_uid: planUid });

      // Add tasks
      const item1Result = await mcpClient.callTool('add_item', {
        plan_uid: planUid,
        kind: 'action',
        title: 'Add try-catch to API fetch calls',
        body: 'Wrap fetch() calls in api.ts with try-catch blocks, typed error responses, and user-facing error messages.',
        file_specs: [{ path: 'packages/web/src/api.ts', action: 'modify' }],
      });
      const item1Uid = JSON.parse(item1Result.content?.[0]?.text || '{}').uid;

      await mcpClient.callTool('add_item', {
        plan_uid: planUid,
        kind: 'action',
        title: 'Add error boundary to UserList',
        body: 'Wrap UserList component with React error boundary and a graceful fallback UI.',
        file_specs: [{ path: 'packages/web/src/UserList.tsx', action: 'modify' }],
      });

      await mcpClient.callTool('add_item', {
        plan_uid: planUid,
        kind: 'action',
        title: 'Add retry logic with exponential backoff',
        body: 'Create a reusable fetchWithRetry() utility with configurable max retries and jitter.',
        file_specs: [{ path: 'packages/web/src/api.ts', action: 'modify' }],
      });

      await mcpClient.callTool('add_item', {
        plan_uid: planUid,
        kind: 'action',
        title: 'Create structured error logging service',
        body: 'Logger module that captures errors with stack traces and request context.',
        file_specs: [
          { path: 'packages/web/src/services/logger.ts', action: 'create' },
          { path: 'services/api/app/logger.py', action: 'create' },
        ],
      });

      await mcpClient.callTool('add_item', {
        plan_uid: planUid,
        kind: 'action',
        title: 'Add user-facing error notification toast',
        body: 'ErrorToast component that surfaces API errors with actionable messages.',
        file_specs: [{ path: 'packages/web/src/components/ErrorToast.tsx', action: 'create' }],
      });

      // Spec doc
      await mcpClient.callTool('add_plan_doc', {
        plan_uid: planUid,
        doc_type: 'executive',
        title: 'Error Handling Strategy',
        body: [
          '## Approach',
          '',
          'Two-phase rollout: harden the frontend against unhandled rejections,',
          'then add structured error reporting for observability.',
          '',
          '### Phase 1 — Frontend resilience',
          '- Wrap all `fetch()` calls with try-catch and typed error responses',
          '- Add React error boundaries around data-fetching components',
          '- Implement retry with exponential backoff for transient failures',
          '',
          '### Phase 2 — Observability',
          '- Structured JSON logging with request context',
          '- User-facing toast notifications for actionable errors',
        ].join('\n'),
      });

      // Open plan workspace
      await page.getByRole('button', { name: 'Plans', exact: true }).first().click({ force: true });
      await wait(page, 500);
      await page.locator('text=Add Error Handling').first().click({ force: true });
      await wait(page, 2000);

      // Agent claims and works on task 1
      await mcpClient.callTool('claim_item', {
        uid: item1Uid,
        agent_type: 'claude-code',
      });
      await mcpClient.callTool('update_item_progress', {
        uid: item1Uid,
        percent: 65,
        message: 'Wrapping fetch calls with error handling',
      });
      await wait(page, 1500);

      await page.screenshot({ path: `${OUT}/keep-on-track/agent-plan-building.png`, fullPage: false });
    } finally {
      mcpClient.close();
    }
  });

  test('full-workspace — plan + graph + terminal three-panel layout', async ({ page, request }) => {
    await gotoWithProject(page, { projectPath: tempFixture });
    await wait(page, 2000);

    // Spawn Claude Code in terminal for the three-panel shot
    termId2 = await spawnTerminal(request, {
      preset: 'shell',
      cwd: tempFixture,
    });
    await wait(page, 500);

    // Open terminal panel
    const terminalBtn = page.locator('button:has-text("Terminal")').last();
    await terminalBtn.click({ force: true });
    await wait(page, 1000);

    // Launch Claude Code (MCP server configured globally)
    await injectPrompt(request, termId2, 'claude\n');
    await wait(page, 4000);

    // Accept workspace trust
    await injectPrompt(request, termId2, '\r');
    await wait(page, 8000);

    // Dismiss any follow-up prompts
    await injectPrompt(request, termId2, '\r');
    await wait(page, 5000);

    // Type a planning prompt tied to CodeTrellis, then submit
    await injectPrompt(request, termId2, 'read the current plans in codetrellis and pick up the next task');
    await wait(page, 500);
    await injectPrompt(request, termId2, '\r');
    // Auto-accept Claude Code's "Do you want to proceed?" permission prompts
    await wait(page, 15000);
    await injectPrompt(request, termId2, '\r');
    await wait(page, 10000);
    await injectPrompt(request, termId2, '\r');
    await wait(page, 10000);
    await injectPrompt(request, termId2, '\r');
    await wait(page, 15000);

    // Open plan panel
    await page.getByRole('button', { name: 'Plans', exact: true }).first().click({ force: true });
    await wait(page, 500);
    const planRow = page.locator('text=Add Error Handling').first();
    if (await planRow.isVisible({ timeout: 3000 }).catch(() => false)) {
      await planRow.click({ force: true });
      await wait(page, 1500);
    }

    // Split view — plan + graph
    await page.keyboard.press('Meta+\\');
    await wait(page, 1500);

    await page.screenshot({ path: `${OUT}/keep-on-track/full-workspace.png`, fullPage: false });
  });

  test('drift-detection — agent edited unplanned file', async ({ page, request }) => {
    await gotoWithProject(page, { projectPath: tempFixture });
    await wait(page, 2000);

    const mcpClient = await createMcpClient();
    try {
      await mcpClient.callTool('register_session', {
        agent_type: 'claude-code',
        agent_model: 'claude-sonnet-4-20250514',
        project_path: tempFixture,
      });

      const plansRes = await request.get(`${API}/plans`);
      const plans = await plansRes.json();
      const plan = plans.find((p: any) => p.title?.includes('Error Handling'));

      if (plan) {
        await mcpClient.callTool('set_active_plan', { plan_uid: plan.uid });

        // Simulate deviation: edit unplanned file
        const dbFile = path.join(tempFixture, 'services/api/app/db.py');
        if (fs.existsSync(dbFile)) {
          fs.appendFileSync(dbFile, '\n# Unplanned modification by agent\ndef health_check():\n    return {"status": "ok"}\n');
        }

        await mcpClient.callTool('detect_deviations', { plan_uid: plan.uid });
        await wait(page, 2000);

        // Open plan
        await page.getByRole('button', { name: 'Plans', exact: true }).first().click({ force: true });
        await wait(page, 500);
        await page.locator('text=Add Error Handling').first().click({ force: true });
        await wait(page, 2000);

        // Show Changes/Diff tab
        const changesBtn = page.locator('button:has-text("Changes")').or(
          page.locator('button:has-text("Diff")'),
        ).first();
        if (await changesBtn.isVisible({ timeout: 3000 }).catch(() => false)) {
          await changesBtn.click({ force: true });
          await wait(page, 2000);
        }
      }

      await page.screenshot({ path: `${OUT}/keep-on-track/drift-detection.png`, fullPage: false });
    } finally {
      mcpClient.close();
    }
  });

  test('timeline — agent tool calls in chronological order', async ({ page }) => {
    await gotoWithProject(page, { projectPath: tempFixture });
    await wait(page, 2000);

    const timelineBtn = page.locator('button:has-text("Timeline")').first();
    if (await timelineBtn.isVisible({ timeout: 3000 }).catch(() => false)) {
      await timelineBtn.click({ force: true });
      await wait(page, 2000);
    }

    await page.screenshot({ path: `${OUT}/keep-on-track/timeline.png`, fullPage: false });
  });
});

// ═════════════════════════════════════════════════
// ONBOARDING — welcome, MCP guide, settings
// ═════════════════════════════════════════════════

test.describe('onboarding/', () => {
  test.setTimeout(60_000);

  test('welcome — clean entry point', async ({ page }) => {
    await gotoWelcome(page, { skipLearnTrellis: true });
    await wait(page, 1500);
    await page.screenshot({ path: `${OUT}/onboarding/welcome.png`, fullPage: false });
  });

  test('mcp-guide — agent connection setup', async ({ page }) => {
    await gotoWelcome(page, { skipLearnTrellis: true });
    await wait(page, 1000);

    const connectBtn = page.locator('button:has-text("Connect Agent")').first();
    if (await connectBtn.isVisible({ timeout: 5000 }).catch(() => false)) {
      await connectBtn.click();
      await wait(page, 1000);
    }

    await page.screenshot({ path: `${OUT}/onboarding/mcp-guide.png`, fullPage: false });
  });

  test('settings — configuration modal', async ({ page, request }) => {
    await request.post(`${API}/project/scan`, {
      data: { projectPath: PROJECT_PATH },
    });
    await gotoWithProject(page);
    await wait(page, 2000);

    const settingsBtn = page.locator('button[aria-label="Settings"]').or(
      page.locator('button:has-text("Settings")'),
    ).first();
    if (await settingsBtn.isVisible({ timeout: 3000 }).catch(() => false)) {
      await settingsBtn.click();
    } else {
      await page.keyboard.press('Meta+,');
    }
    await wait(page, 1000);

    await page.screenshot({ path: `${OUT}/onboarding/settings.png`, fullPage: false });
  });
});
