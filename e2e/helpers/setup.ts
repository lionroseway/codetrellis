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

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { type Page, type Locator, type APIRequestContext, expect } from '@playwright/test';

export const API = 'http://localhost:3001/api';
export const PROJECT_PATH = process.cwd();

/**
 * Every API call from a test needs the per-launch capability token.
 *
 * Phase 19's first rule is that loopback is not an authorisation
 * boundary, so `/api/*` authenticates — including from a test. The
 * helpers here did not send it, and the failure was quiet in exactly the
 * wrong way: `cleanupPlans` checked `res.ok()` and skipped its work on a
 * 401, so plans accumulated without complaint, while `seedPlan` failed
 * its own expect and took every spec that seeds a plan down with it.
 *
 * Sending it from one place means a spec cannot forget, and a future
 * endpoint that starts authenticating does not break the suite again.
 */
export function authHeaders(): Record<string, string> {
  // playwright.config.ts pins the token for the run and the backend adopts
  // it, so this is the value the server holds. The file is the fallback
  // for a run against a server this config did not start.
  const pinned = process.env.CODETRELLIS_CAPABILITY_TOKEN;
  if (pinned) return { 'x-codetrellis-token': pinned };
  const dataDir = process.env.CODETRELLIS_DATA_DIR ?? path.join(os.homedir(), '.codetrellis');
  try {
    return {
      'x-codetrellis-token': fs.readFileSync(path.join(dataDir, 'capability-token'), 'utf-8').trim(),
    };
  } catch {
    // No token on disk: let the request go out unauthenticated so the
    // failure says 401 rather than ENOENT, which is the more useful
    // thing to read in a report.
    return {};
  }
}

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
      // The guide auto-opens once on first run and covers the app, so a
      // test that does not skip it cannot click anything. The old
      // learn-trellis key is kept for profiles that predate the guide.
      localStorage.setItem('codetrellis:guide:seen', '1');
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
    headers: authHeaders(),
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
      headers: authHeaders(),
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
  // Click Plans tab — use .first() because 'Plans' may appear in
  // both the PlanPanel tab bar and other contexts.
  await page.getByRole('button', { name: 'Plans', exact: true }).first().click();
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
  const res = await request.get(`${API}/plans`, { headers: authHeaders() });
  if (!res.ok()) {
    // Say so rather than silently leaving the plans behind. A cleanup
    // that no-ops looks identical to one that worked until the next run
    // finds forty stale plans in the list.
    console.warn(`[e2e] cleanupPlans could not list plans (${res.status()}) — nothing removed`);
    return;
  }
  const body = await res.json();
  const plans: Array<{ uid: string; title: string; status: string }> =
    Array.isArray(body) ? body : (body?.plans ?? []);
  for (const p of plans) {
    if (p.title.includes(titlePattern) && p.status !== 'archived') {
      await request.delete(`${API}/plans/${p.uid}`, { headers: authHeaders() });
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
  const res = await request.get(`${API}/sessions`, { headers: authHeaders() });
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

/**
 * The first graph node a person could actually click.
 *
 * `.react-flow__node` `.first()` is whichever node sorts first, and the
 * graph toolbar (modes, card style, baseline, filters, export) overlays
 * the top of the canvas. When the first node landed under it, every click
 * retried "element intercepts pointer events" until the test timed out -
 * which is what happened when a new import made `e2e/helpers/setup.ts`
 * a hub and a `setup` cluster sorted first. Pick by hit-test instead.
 */
export async function firstClickableNode(page: Page, selector = '.react-flow__node'): Promise<Locator> {
  const [index = 0] = await clickableNodeIndices(page, selector);
  return page.locator(selector).nth(index);
}

/** Indices (into `selector`'s matches) of nodes whose centre is really that node. */
export async function clickableNodeIndices(page: Page, selector = '.react-flow__node'): Promise<number[]> {
  await page.locator(selector).first().waitFor({ timeout: 10_000 });
  return page.evaluate((sel) => {
    const out: number[] = [];
    Array.from(document.querySelectorAll(sel)).forEach((n, i) => {
      const r = n.getBoundingClientRect();
      const x = r.left + r.width / 2;
      const y = r.top + r.height / 2;
      if (x < 0 || y < 0 || x > window.innerWidth || y > window.innerHeight) return;
      const hit = document.elementFromPoint(x, y);
      if (hit && n.contains(hit)) out.push(i);
    });
    return out;
  }, selector);
}
