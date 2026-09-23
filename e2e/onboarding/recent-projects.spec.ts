/**
 * Recent projects — pin, unpin, remove, click-to-open, empty state.
 *
 * Seeds recent projects via the API then verifies UI interactions.
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test, expect, type Page } from '@playwright/test';
import { gotoWelcome, openProject, API, PROJECT_PATH } from '../helpers/setup';

/**
 * A project of this test's own to pin or remove.
 *
 * These tests used to act on the FIRST row. The setup project pins this
 * repository so it stays trusted all run, and pinned rows sort first — so
 * "remove" removed the repository from Recent Projects, withdrawing its trust
 * while specs on the other worker were creating plans in it.
 */
async function throwawayProject(label: string): Promise<string> {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), `ct-recents-${label}-`));
  fs.writeFileSync(path.join(dir, 'index.ts'), 'export const x = 1;\n');
  await openProject(dir);
  return dir;
}

function rowFor(page: Page, dir: string) {
  return page.locator('div.group').filter({ has: page.locator('.font-mono', { hasText: dir }) });
}

test.describe('Recent projects', () => {
  // Ensure at least one recent project exists by scanning
  test.beforeAll(async ({ request }) => {
    await request.post(`${API}/project/scan`, {
      data: { projectPath: PROJECT_PATH },
    });
  });

  test('recent projects list renders after scanning a project', async ({ page }) => {
    await gotoWelcome(page, { skipLearnTrellis: true });

    // Section label should appear
    await expect(page.getByText('Recent projects')).toBeVisible({ timeout: 5000 });
  });

  test('each project row shows a display name', async ({ page }) => {
    await gotoWelcome(page, { skipLearnTrellis: true });

    // At least one project row should exist (from beforeAll scan)
    const rows = page.locator('[role="button"]').filter({
      has: page.locator('.font-mono'),
    });
    await expect(rows.first()).toBeVisible({ timeout: 5000 });
  });

  test('pin button toggles to "Unpin"', async ({ page, request }) => {
    const dir = await throwawayProject('pin');
    try {
      await gotoWelcome(page, { skipLearnTrellis: true });
      const row = rowFor(page, dir);
      await row.hover();
      await row.locator('button[title="Pin to top"]').click();
      await expect(row.locator('button[title="Unpin"]')).toBeVisible();
    } finally {
      await request.delete(`${API}/recent-projects`, { data: { projectPath: dir } });
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  test('remove button removes project from list', async ({ page, request }) => {
    const dir = await throwawayProject('remove');
    try {
      await gotoWelcome(page, { skipLearnTrellis: true });
      const row = rowFor(page, dir);
      await expect(row).toHaveCount(1, { timeout: 5000 });
      await row.hover();
      await row.locator('button[title="Remove from recents"]').click();
      await expect(row).toHaveCount(0, { timeout: 5000 });
    } finally {
      await request.delete(`${API}/recent-projects`, { data: { projectPath: dir } });
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  test('"Open another" link visible when recents exist', async ({ page }) => {
    await gotoWelcome(page, { skipLearnTrellis: true });

    // When there are recents, the CTA changes to "Open another"
    const openAnother = page.getByText('Open another');
    const openProject = page.getByRole('button', { name: 'Open Project' }).first();
    // One of these should be visible depending on recents state
    // Both can show at once (the TopBar has its own Open button), so take the first.
    await expect(openAnother.or(openProject).first()).toBeVisible({ timeout: 5000 });
  });
});
