/**
 * The UX audit capture (Phase 32 §0.5).
 *
 * Every panel, tab, empty state and error state the web build can show,
 * photographed, so each can be reviewed against the UX rules
 * (PHASE-32-EXECUTION §1.6) and re-shot after a fix. Each test also proves
 * the thing it photographs opens at all.
 *
 * Captures go to test-results/ux-audit/ (not committed); a PR attaches the
 * ones it changes.
 *
 * Serial (playwright.config SERIAL_SPECS): its agent posts presence cards
 * and freezes the project, which reach every open page.
 */

import fs from 'node:fs';
import path from 'node:path';
import { test, expect, type Page } from '@playwright/test';
import { gotoWithProject, seedPlan, openPlan, cleanupPlans, API, authHeaders, PROJECT_PATH } from '../helpers/setup';
import { createMcpClient } from '../helpers/mcp-client';

const OUT = path.join('test-results', 'ux-audit');
const TAG = 'E2E UX audit';

async function shot(page: Page, name: string) {
  fs.mkdirSync(OUT, { recursive: true });
  // Animations settle; a spinner caught mid-frame is not what a person sees.
  await page.waitForTimeout(400);
  await page.screenshot({ path: path.join(OUT, `${name}.png`) });
}

const settingsDialog = (page: Page) => page.getByRole('dialog', { name: 'Settings' });

test.describe.serial('UX audit capture', () => {
  test.setTimeout(90_000);
  test.use({ viewport: { width: 1440, height: 900 } });

  let planUid = '';

  test.beforeAll(async ({ request }) => {
    await cleanupPlans(request, TAG);
    const seeded = await seedPlan(request, {
      title: `${TAG} plan`,
      actions: [
        { title: 'Wire the loader', body: 'Load the config once, at start.', fileSpecs: [{ path: 'src/backend/server.ts', action: 'modify' }] },
        { title: 'Check the totals', body: 'Totals match the ledger.' },
      ],
    });
    planUid = seeded.uid;
  });

  test.afterAll(async ({ request }) => {
    await cleanupPlans(request, TAG);
    await request.put(`${API}/freeze`, { headers: authHeaders(), data: { projectPath: PROJECT_PATH, active: false } }).catch(() => {});
  });

  test('graph: packages, files, symbols, and a file in the inspector', async ({ page }) => {
    await gotoWithProject(page);
    await shot(page, '01-graph-packages');
    await page.locator('button:has-text("Files")').first().click();
    await page.waitForTimeout(1200);
    await shot(page, '02-graph-files');
    await page.locator('button:has-text("Symbols")').first().click();
    await page.waitForTimeout(1200);
    await shot(page, '03-graph-symbols');
    await page.getByText('package.json', { exact: true }).first().click();
    await page.waitForTimeout(800);
    await shot(page, '04-inspector-file');
  });

  test('narrower windows: the toolbar at 1280 and 1024', async ({ page }) => {
    await gotoWithProject(page);
    await page.setViewportSize({ width: 1280, height: 800 });
    await shot(page, '05-toolbar-1280');
    await page.setViewportSize({ width: 1024, height: 768 });
    await shot(page, '06-toolbar-1024');
  });

  test('branch info', async ({ page }) => {
    await gotoWithProject(page);
    await page.locator('button[title^="Branch info"]').click();
    await shot(page, '07-branch-info');
  });

  test('plans: list, a plan open, an item selected', async ({ page }) => {
    await gotoWithProject(page);
    await openPlan(page, `${TAG} plan`);
    await shot(page, '08-plan-workspace');
    await page.getByText('Wire the loader').first().click();
    await page.waitForTimeout(600);
    await shot(page, '09-plan-item');
  });

  test('docs: the system docs surface', async ({ page }) => {
    await gotoWithProject(page);
    await page.getByRole('button', { name: 'Docs', exact: true }).click();
    await page.waitForTimeout(800);
    await shot(page, '10-docs');
  });

  test('code: the code-first surface', async ({ page }) => {
    await gotoWithProject(page);
    await page.getByRole('button', { name: 'Code', exact: true }).click();
    await page.waitForTimeout(1200);
    await shot(page, '11-code');
  });

  test('brief: the plans as work to be done', async ({ page }) => {
    await gotoWithProject(page);
    await page.getByRole('button', { name: 'Brief', exact: true }).click();
    await page.waitForTimeout(1200);
    await shot(page, '12-brief');
  });

  test('settings: every section', async ({ page }) => {
    await gotoWithProject(page);
    await page.locator('button[title*="Settings"]').click();
    const dialog = settingsDialog(page);
    await expect(dialog).toBeVisible();
    const sections = [
      'Identity', 'Appearance', 'MCP Server', 'Plans', 'Data', 'Devices',
      'Power', 'Sync', 'Logs', 'Telemetry', 'Updates', 'About',
    ];
    for (const [i, section] of sections.entries()) {
      await dialog.getByRole('button', { name: section, exact: true }).click();
      await shot(page, `13-settings-${String(i + 1).padStart(2, '0')}-${section.toLowerCase().replace(/\s+/g, '-')}`);
    }
  });

  test('settings: a save that is refused says why', async ({ page }) => {
    await gotoWithProject(page);
    await page.locator('button[title*="Settings"]').click();
    const dialog = settingsDialog(page);
    await dialog.getByRole('button', { name: 'MCP Server', exact: true }).click();
    const port = dialog.locator('input[type="number"]').first();
    await port.fill('80');
    await port.blur();
    await expect(page.getByTestId('settings-save-error')).toContainText('Not saved');
    await shot(page, '14-settings-refused');
  });

  test('the guide, the folder picker', async ({ page }) => {
    await gotoWithProject(page);
    await page.getByRole('button', { name: 'Open onboarding tour' }).click();
    await page.waitForTimeout(600);
    await shot(page, '15-guide');
    await page.keyboard.press('Escape');
    await page.evaluate(() => window.dispatchEvent(new CustomEvent('open-folder-picker')));
    await page.waitForTimeout(800);
    await shot(page, '16-folder-picker');
  });

  test('terminal panel: empty, then with a shell', async ({ page, request }) => {
    await gotoWithProject(page);
    await page.locator('button[title^="Toggle terminal"]').click();
    await page.waitForTimeout(600);
    await shot(page, '17-terminal-empty');
    const res = await request.post(`${API}/terminals`, { headers: authHeaders(), data: { preset: 'shell', cwd: PROJECT_PATH } });
    expect(res.ok()).toBe(true);
    const { id } = await res.json();
    try {
      await page.waitForTimeout(1500);
      await shot(page, '18-terminal-shell');
    } finally {
      await request.delete(`${API}/terminals/${id}`, { headers: authHeaders() });
    }
  });

  test('audio capture bar', async ({ page }) => {
    await gotoWithProject(page);
    await page.locator('button[title^="Audio capture"]').click();
    await shot(page, '19-audio-bar');
  });

  test('an agent at work: connected, presence cards, a deletion request, flagged freeze and budget', async ({ page }) => {
    const client = await createMcpClient();
    try {
      await gotoWithProject(page);
      await client.callTool('register_session', { agent_type: 'claude-code' });
      await client.callTool('present', { title: 'Starting on the loader', text: 'Reading `server.ts` first.', tone: 'neutral' });
      await client.callTool('present', { title: 'Ready to switch the loader over?', text: 'This replaces the per-request read.', tone: 'question', require_ack: true });
      await page.waitForTimeout(1500);
      await shot(page, '20-presence-and-agents');

      await client.callTool('request_plan_deletion', { plan_uids: [planUid], reason: 'Superseded by the new loader plan' });
      await page.waitForTimeout(1500);
      await shot(page, '21-deletion-request');
      // Answered, not dismissed: a pending request opens on every page that
      // loads afterwards, including the next spec's.
      await page.getByRole('button', { name: 'Keep it' }).click();

      await client.callTool('set_freeze', { project_path: PROJECT_PATH, active: true, reason: 'Release week' });
      await client.callTool('set_budget', { plan_uid: planUid, minutes: 240 });
      await openPlan(page, `${TAG} plan`);
      await page.waitForTimeout(1500);
      await shot(page, '22-freeze-and-budget-flags');
      await page.getByTestId('plan-budget-chip').click().catch(() => {});
      await page.waitForTimeout(600);
      await shot(page, '23-budget-flag-open');
    } finally {
      await client.callTool('set_freeze', { project_path: PROJECT_PATH, active: false }).catch(() => {});
      client.close();
    }
  });
});
