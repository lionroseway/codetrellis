/**
 * Shared helpers for browser E2E tests.
 *
 * Every test that needs a project open imports `gotoWithProject`.
 * Every test that needs a plan imports `seedPlan` / `openPlan`.
 *
 * These helpers use the `__test_open_project__` custom event that
 * App.tsx listens for, injecting state directly into Zustand stores
 * so we never have to touch the native folder picker.
 */

import { type Page, type APIRequestContext, expect } from '@playwright/test';

export const API = 'http://localhost:3001/api';
export const PROJECT_PATH = process.cwd();

// ─────────────────────────────────────────────────
// Setup helpers
// ─────────────────────────────────────────────────

/**
 * Navigate to the app with a project already open and scanned.
 *
 * Skips all onboarding (Learn Trellis + Getting Started) by default.
 * Waits for the ReactFlow canvas to render.
 */
export async function gotoWithProject(
  page: Page,
  opts: {
    skipOnboarding?: boolean;
    /** Override project path (defaults to cwd) */
    projectPath?: string;
  } = {},
) {
  const projectPath = opts.projectPath ?? PROJECT_PATH;
  const skipOnboarding = opts.skipOnboarding ?? true;

  if (skipOnboarding) {
    await page.addInitScript((pp: string) => {
      localStorage.setItem('codetrellis:learn-trellis:seen', '1');
      localStorage.setItem(`codetrellis:gettingStarted:dismissed:${pp}`, '1');
    }, projectPath);
  }

  await page.goto('/');

  // Wait for React to mount
  await page.locator('text=Explorer')
    .or(page.getByText('Open Project'))
    .first()
    .waitFor({ timeout: 10_000 });

  // Scan via API then inject into Zustand stores.
  // Note: The WASM tree-sitter parser can become unstable after many
  // sequential scans (>40). When running large test suites, split into
  // groups of ~40 tests or restart the server between groups.
  await page.evaluate(async (pp: string) => {
    // Scan — retry up to 3 times with increasing delays
    let result: any;
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        const res = await fetch('/api/project/scan', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ projectPath: pp }),
        });
        const text = await res.text();
        result = JSON.parse(text);
        break;
      } catch {
        if (attempt < 2) await new Promise((r) => setTimeout(r, 1000 * (attempt + 1)));
        else throw new Error(`/api/project/scan failed after 3 attempts`);
      }
    }

    let branch: string | null = null;
    try {
      const brRes = await fetch(`/api/git/branch?path=${encodeURIComponent(pp)}`);
      const brData = await brRes.json();
      branch = brData.branch;
    } catch { /* ignore */ }

    window.dispatchEvent(
      new CustomEvent('__test_open_project__', {
        detail: { projectPath: pp, branch, result },
      }),
    );
  }, projectPath);

  // Wait for graph canvas to render
  await page.locator('.react-flow').waitFor({ timeout: 15_000 });
}

/**
 * Navigate to `/` without opening a project — for testing the
 * welcome screen and onboarding flows.
 */
export async function gotoWelcome(
  page: Page,
  opts: { skipLearnTrellis?: boolean } = {},
) {
  if (opts.skipLearnTrellis) {
    await page.addInitScript(() => {
      localStorage.setItem('codetrellis:learn-trellis:seen', '1');
    });
  }

  await page.goto('/');
  await page.locator('text=Explorer')
    .or(page.getByText('Open Project'))
    .or(page.getByText('CodeTrellis'))
    .first()
    .waitFor({ timeout: 10_000 });
}

// ─────────────────────────────────────────────────
// Plan helpers
// ─────────────────────────────────────────────────

export interface SeededPlan {
  uid: string;
  title: string;
  actionUids: string[];
}

/**
 * Create a plan with items via the API. Returns UIDs for use in tests.
 */
export async function seedPlan(
  request: APIRequestContext,
  opts: {
    title?: string;
    projectPath?: string;
    actions?: Array<{
      title: string;
      body?: string;
      fileSpecs?: Array<{ path: string; action: string }>;
    }>;
  } = {},
): Promise<SeededPlan> {
  const title = opts.title ?? 'E2E Test Plan';
  const projectPath = opts.projectPath ?? PROJECT_PATH;

  // Create the plan
  const planRes = await request.post(`${API}/plans`, {
    data: {
      title,
      description: 'Created by E2E test helper',
      projectPath,
    },
  });
  expect(planRes.ok()).toBeTruthy();
  const plan = await planRes.json();

  // Add action items
  const actionUids: string[] = [];
  const actions = opts.actions ?? [
    {
      title: 'Default test action',
      body: 'Test action body',
      fileSpecs: [{ path: 'src/backend/server.ts', action: 'modify' }],
    },
  ];

  for (const action of actions) {
    const itemRes = await request.post(`${API}/plans/${plan.uid}/items`, {
      data: {
        kind: 'action',
        title: action.title,
        template: 'action',
        body: action.body ?? '',
        status: 'pending',
        fileSpecs: action.fileSpecs ?? [],
      },
    });
    expect(itemRes.ok()).toBeTruthy();
    const item = await itemRes.json();
    actionUids.push(item.uid);
  }

  return { uid: plan.uid, title, actionUids };
}

/**
 * Open an existing plan in the workspace UI.
 * Assumes the page is already at the app with a project open.
 */
export async function openPlan(page: Page, planTitle: string) {
  // Click Plans tab
  await page.getByRole('button', { name: 'Plans', exact: true }).click();
  // Click the plan row
  await page.locator(`text=${planTitle}`).first().click();
  // Wait for workspace to load
  await page.waitForTimeout(1500);
}

/**
 * Clean up plans created during tests.
 */
export async function cleanupPlans(
  request: APIRequestContext,
  titlePattern: string,
) {
  const res = await request.get(`${API}/plans`);
  if (res.ok()) {
    const plans = await res.json();
    for (const p of plans) {
      if (p.title.includes(titlePattern) && p.status !== 'archived') {
        await request.delete(`${API}/plans/${p.uid}`);
      }
    }
  }
}

// ─────────────────────────────────────────────────
// Agent helpers
// ─────────────────────────────────────────────────

/**
 * Seed an MCP agent session via the API so the Connected Agents
 * widget has something to show. Returns the session info.
 */
export async function seedAgentSession(request: APIRequestContext) {
  // The agent status endpoint doesn't create sessions, but we can
  // check what's there. For a real agent session we'd need the MCP
  // transport, so browser tests typically verify the UI elements
  // are rendering correctly with whatever sessions exist.
  const res = await request.get(`${API}/sessions`);
  return res.json();
}

// ─────────────────────────────────────────────────
// Wait / utility helpers
// ─────────────────────────────────────────────────

/**
 * Wait for a toast notification to appear with the given text.
 */
export async function waitForToast(page: Page, text: string | RegExp) {
  const toast = page.locator('[data-testid="toast"], .toast, [role="alert"]')
    .filter({ hasText: text });
  await toast.waitFor({ timeout: 5000 });
  return toast;
}

/**
 * Get the current state of a Zustand store via page.evaluate.
 * Useful for asserting internal state without relying solely on DOM.
 */
export async function getStoreState(page: Page, storeName: string) {
  return page.evaluate((name) => {
    // Zustand stores attach to the window in dev mode for debugging
    return (window as any).__ZUSTAND_STORES__?.[name]?.getState();
  }, storeName);
}
