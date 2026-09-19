/**
 * The Settings panel the refusal messages point at.
 *
 * Phase 30 refuses a tool with "needs the X capability … Turn it on in
 * Settings → MCP Server". That sentence is a promise about a UI, and an
 * agent will repeat it to the user verbatim. If the panel does not render,
 * or the toggles do not persist, the refusal is a dead end and the whole
 * gate reads as the app being broken.
 *
 * Driven through the real app because that is the only way to know the
 * checkbox writes what the backend reads.
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test, expect, type Page } from '@playwright/test';
import { gotoWithProject } from '../helpers/setup';

const API = 'http://localhost:3001/api';
const PROJECT_PATH = path.resolve(process.cwd(), 'tests/fixtures/sample-app');

const authHeaders = (): Record<string, string> => {
  try {
    return {
      'x-codetrellis-token': fs
        .readFileSync(path.join(os.homedir(), '.codetrellis', 'capability-token'), 'utf-8')
        .trim(),
    };
  } catch {
    return {};
  }
};

async function openMcpSettings(page: Page) {
  await page.getByTitle(/^Settings/).click();
  await page.getByRole('button', { name: 'MCP Server', exact: true }).click();
  await expect(page.getByText('What connected agents may do')).toBeVisible({ timeout: 10_000 });
}

test.describe('Settings → MCP Server (Phase 30)', () => {
  test.setTimeout(90_000);

  test('the capability panel the refusal names actually exists', async ({ page }) => {
    await gotoWithProject(page, { projectPath: PROJECT_PATH });
    await openMcpSettings(page);

    // All seven, with the three sensitive ones present — an agent told to
    // ask for `terminal` must find something called that.
    for (const label of [
      /Read plans, items and the graph/,
      /Change plans, and drive the UI/,
      /Open, close and rescan projects/,
      /Read and write plan files/,
      /Read your screen, clipboard and microphone/,
      /Change desktop settings/,
      /Run commands/,
    ]) {
      await expect(page.getByText(label)).toBeVisible();
    }
  });

  test('the defaults on screen match the defaults the gate enforces', async ({ page }) => {
    await gotoWithProject(page, { projectPath: PROJECT_PATH });
    // Clear any grant a previous test left, so this reads a fresh install.
    await page.request.put(`${API}/settings`, {
      headers: authHeaders(),
      data: { mcp: { capabilities: ['read', 'write', 'project', 'files'] } },
    });
    await openMcpSettings(page);

    const box = (label: RegExp) =>
      page.locator('label').filter({ hasText: label }).locator('input[type="checkbox"]');

    await expect(box(/Read plans, items and the graph/)).toBeChecked();
    await expect(box(/Read and write plan files/)).toBeChecked();
    // The three that are off until the user says otherwise. If any of these
    // ever ships checked, connecting an agent hands it a shell, a
    // microphone, or the switch that exposes this machine.
    await expect(box(/Run commands/)).not.toBeChecked();
    await expect(box(/Read your screen, clipboard and microphone/)).not.toBeChecked();
    await expect(box(/Change desktop settings/)).not.toBeChecked();
  });

  test('ticking a capability persists to what the gate reads', async ({ page }) => {
    await gotoWithProject(page, { projectPath: PROJECT_PATH });
    await page.request.put(`${API}/settings`, {
      headers: authHeaders(),
      data: { mcp: { capabilities: ['read', 'write', 'project', 'files'] } },
    });
    await openMcpSettings(page);

    const terminal = page
      .locator('label').filter({ hasText: /Run commands/ })
      .locator('input[type="checkbox"]');

    // `click`, not `check`. The box is controlled by the PUT response
    // rather than by local state, so it does not flip until the server
    // answers — and Playwright's `check()` asserts the new state the
    // instant it clicks. Worth knowing about this control: a failed save
    // leaves the box where it was and says nothing.
    await expect(terminal).not.toBeChecked();
    await terminal.click();
    await expect(terminal).toBeChecked({ timeout: 10_000 });

    // The gate reads `settings.mcp.capabilities`. A checkbox that updates
    // only React state would look right and change nothing.
    await expect.poll(async () => {
      const res = await page.request.get(`${API}/settings`, { headers: authHeaders() });
      const s = (await res.json()) as { mcp?: { capabilities?: string[] } };
      return s.mcp?.capabilities ?? [];
    }, { timeout: 10_000 }).toContain('terminal');

    // And unticking takes it away again — a grant you cannot revoke is
    // worse than one you never had.
    await terminal.click();
    await expect(terminal).not.toBeChecked({ timeout: 10_000 });
    await expect.poll(async () => {
      const res = await page.request.get(`${API}/settings`, { headers: authHeaders() });
      const s = (await res.json()) as { mcp?: { capabilities?: string[] } };
      return s.mcp?.capabilities ?? [];
    }, { timeout: 10_000 }).not.toContain('terminal');
  });

  test('the project scope selector is there and persists', async ({ page }) => {
    await gotoWithProject(page, { projectPath: PROJECT_PATH });
    await openMcpSettings(page);

    const scope = page.locator('select').filter({ hasText: 'Only projects I have opened' });
    await expect(scope).toBeVisible();
    await expect(scope).toHaveValue('opened');

    await scope.selectOption('anywhere');
    await expect.poll(async () => {
      const res = await page.request.get(`${API}/settings`, { headers: authHeaders() });
      const s = (await res.json()) as { mcp?: { projectScope?: string } };
      return s.mcp?.projectScope;
    }, { timeout: 10_000 }).toBe('anywhere');

    // Put it back — `opened` is the secure default and the rest of the
    // suite assumes it.
    await scope.selectOption('opened');
    await expect.poll(async () => {
      const res = await page.request.get(`${API}/settings`, { headers: authHeaders() });
      const s = (await res.json()) as { mcp?: { projectScope?: string } };
      return s.mcp?.projectScope;
    }, { timeout: 10_000 }).toBe('opened');
  });

  test('the panel says what the scope does not do', async ({ page }) => {
    // It confines path-taking tools; it is not a sandbox, and saying so
    // would be the kind of oversell this pass keeps finding.
    await gotoWithProject(page, { projectPath: PROJECT_PATH });
    await openMcpSettings(page);
    await expect(page.getByText(/not a sandbox/i)).toBeVisible();
  });
});
