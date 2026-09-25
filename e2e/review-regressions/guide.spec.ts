/**
 * The guide, driven.
 *
 * It replaces a three-step wizard that covered connecting an agent and
 * nothing else — no plans, channels, docs, review, budgets, tickets,
 * terminals or phone — and that named a tool (`report_plan`) which has
 * never existed.
 */

import path from 'node:path';
import { test, expect } from '@playwright/test';
import { gotoWithProject } from '../helpers/setup';

const PROJECT_PATH = path.resolve(process.cwd(), 'tests/fixtures/sample-app');

test.describe('The guide', () => {
  test.setTimeout(90_000);

  test('opens with a rail you can navigate, one topic at a time', async ({ page }) => {
    await gotoWithProject(page, { projectPath: PROJECT_PATH });
    await page.evaluate(() => window.dispatchEvent(new CustomEvent('open-mcp-guide')));

    const dialog = page.getByRole('dialog', { name: 'CodeTrellis guide' });
    await expect(dialog).toBeVisible({ timeout: 10_000 });

    // The groups that make it a reference rather than a tour. Scoped to
    // the rail: the active section's group is also printed above the
    // heading, so an unscoped lookup matches twice.
    const rail = dialog.getByRole('navigation');
    for (const group of ['Getting started', 'Seeing your codebase', 'Planning and work',
                         'Collaboration', 'Governance', 'Reach']) {
      await expect(rail.getByText(group, { exact: true })).toBeVisible();
    }

    // Pick a topic the old guide never mentioned and read it.
    await dialog.getByRole('button', { name: 'Channels', exact: true }).click();
    await expect(dialog.getByRole('heading', { name: /Where an agent asks/ })).toBeVisible();

    // And another, to prove the rail actually switches the main area.
    await dialog.getByRole('button', { name: 'Budgets', exact: true }).click();
    await expect(dialog.getByRole('heading', { name: /What this plan has cost/ })).toBeVisible();
    await expect(dialog.getByRole('heading', { name: /Where an agent asks/ })).toHaveCount(0);
  });

  test('every prompt can be copied', async ({ page, context }) => {
    await context.grantPermissions(['clipboard-read', 'clipboard-write']);
    await gotoWithProject(page, { projectPath: PROJECT_PATH });
    await page.evaluate(() => window.dispatchEvent(new CustomEvent('open-mcp-guide')));

    const dialog = page.getByRole('dialog', { name: 'CodeTrellis guide' });
    await dialog.getByRole('button', { name: 'Plans', exact: true }).click();

    // The prompt is the point of the format — describing a feature leaves
    // the reader to work out how to reach it.
    await expect(dialog.getByText('Ask your agent')).toBeVisible();
    const copy = dialog.getByRole('button', { name: /^Copy$/ }).first();
    await copy.click();
    await expect(dialog.getByRole('button', { name: /Copied/ }).first()).toBeVisible();

    const clip = await page.evaluate(() => navigator.clipboard.readText());
    expect(clip.length, 'the copy button put nothing on the clipboard').toBeGreaterThan(25);
    expect(clip).toMatch(/plan/i);
  });

  test('the connect section still hands over the MCP config', async ({ page }) => {
    await gotoWithProject(page, { projectPath: PROJECT_PATH });
    await page.evaluate(() => window.dispatchEvent(new CustomEvent('open-mcp-guide')));

    const dialog = page.getByRole('dialog', { name: 'CodeTrellis guide' });
    await dialog.getByRole('button', { name: 'Connect an agent', exact: true }).click();
    await expect(dialog.getByText('MCP server config')).toBeVisible();
    // Real config, not the loading placeholder.
    await expect(dialog.locator('pre')).toContainText('codetrellis', { timeout: 10_000 });
  });

  test('it can be opened straight to a topic', async ({ page }) => {
    // So a refusal or an empty state can send someone to the right page
    // rather than to the front of a tour.
    await gotoWithProject(page, { projectPath: PROJECT_PATH });
    await page.evaluate(() =>
      window.dispatchEvent(new CustomEvent('open-mcp-guide', { detail: { section: 'agent-permissions' } })),
    );
    const dialog = page.getByRole('dialog', { name: 'CodeTrellis guide' });
    await expect(dialog.getByRole('heading', { name: /does not hand it everything/ })).toBeVisible();
  });

  // ── Carried over from the specs for the two modals this replaced ──
  // LearnTrellis (a nine-step carousel) and the three-step McpGuideModal
  // were deleted in favour of this guide; their specs kept testing
  // components that no longer render. What they checked that is still
  // TRUE of the guide lives here: first-run behaviour, the seen flag,
  // closing, and the TopBar entry points.

  /** Clear the seen flag once — not on the reload a test does later. */
  async function firstRun(page: import('@playwright/test').Page) {
    await page.addInitScript(() => {
      if (sessionStorage.getItem('e2e:guide-cleared')) return;
      localStorage.removeItem('codetrellis:guide:seen');
      sessionStorage.setItem('e2e:guide-cleared', '1');
    });
  }

  test('opens by itself on first run, once', async ({ page }) => {
    await firstRun(page);
    await page.goto('/');
    const dialog = page.getByRole('dialog', { name: 'CodeTrellis guide' });
    await expect(dialog).toBeVisible({ timeout: 10_000 });
    expect(await page.evaluate(() => localStorage.getItem('codetrellis:guide:seen'))).toBe('1');

    await page.reload();
    await page.waitForTimeout(1500);
    await expect(dialog).toHaveCount(0);
  });

  test('does not open by itself once seen', async ({ page }) => {
    // The suite's storageState sets the flag.
    await page.goto('/');
    await page.waitForTimeout(1500);
    await expect(page.getByRole('dialog', { name: 'CodeTrellis guide' })).toHaveCount(0);
  });

  test('Escape and the close button both close it', async ({ page }) => {
    await gotoWithProject(page, { projectPath: PROJECT_PATH });
    const dialog = page.getByRole('dialog', { name: 'CodeTrellis guide' });

    await page.evaluate(() => window.dispatchEvent(new CustomEvent('open-mcp-guide')));
    await expect(dialog).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(dialog).toHaveCount(0);

    await page.evaluate(() => window.dispatchEvent(new CustomEvent('open-mcp-guide')));
    await expect(dialog).toBeVisible();
    await dialog.getByRole('button', { name: 'Close guide' }).click();
    await expect(dialog).toHaveCount(0);
  });

  test('the TopBar opens it — Connect Agent, and the tour button', async ({ page }) => {
    await gotoWithProject(page, { projectPath: PROJECT_PATH });
    const dialog = page.getByRole('dialog', { name: 'CodeTrellis guide' });

    await page.getByRole('button', { name: 'Connect Agent' }).click();
    await expect(dialog).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(dialog).toHaveCount(0);

    await page.getByRole('button', { name: 'Open onboarding tour' }).click();
    await expect(dialog).toBeVisible();
  });
});
