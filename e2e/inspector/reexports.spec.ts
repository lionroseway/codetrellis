/**
 * Who uses a file through a barrel (Phase 32 A2.2), in the inspector, on this
 * repository's own graph: `src/shared/types/index.ts` is `export * from
 * './agent'` and its siblings, and most of the app imports types from it.
 *
 * Before re-exports were recorded, `agent.ts` showed the handful of files
 * that import it by path and nothing about the dozens that reach it through
 * the barrel; the barrel itself did not appear at all.
 */

import fs from 'node:fs';
import path from 'node:path';
import { test, expect, type Page } from '@playwright/test';
import { gotoWithProject } from '../helpers/setup';

const OUT = path.join('test-results', 'ux-audit');

/** Open a file from the Explorer, a folder at a time. */
async function pickInExplorer(page: Page, filePath: string) {
  const parts = filePath.split('/');
  const row = (name: string) => page.getByRole('button', { name, exact: true }).first();
  for (const [i, name] of parts.entries()) {
    const next = parts[i + 1];
    if (next && (await row(next).isVisible())) continue; // already open
    await row(name).scrollIntoViewIfNeeded();
    await row(name).click();
    if (next) await expect(row(next)).toBeVisible();
  }
}

test.describe('Inspector: re-exports', () => {
  test.use({ viewport: { width: 1440, height: 900 } });

  test('a file reached through a barrel lists the barrel as re-exporting it, and who uses it through the barrel', async ({ page }) => {
    await gotoWithProject(page);
    const answered = page.waitForResponse((r) => r.url().includes('/api/dependencies/file') && r.url().includes('agent.ts'));
    await pickInExplorer(page, 'src/shared/types/agent.ts');
    await answered;

    const inspector = page.locator('.glass-panel.border-l');
    // The barrel is an importer, marked as passing names on.
    const barrelRow = inspector.getByRole('button').filter({ hasText: 'src/shared/types/index.ts' }).first();
    await expect(barrelRow).toContainText('re-exports');

    // And the files that use agent.ts through it are listed, with the route.
    const through = inspector.getByTestId('inspector-through-reexports');
    await expect(through).toBeVisible();
    await expect(inspector.getByText(/^Used through re-exports/)).toBeVisible();
    const rows = through.getByRole('button');
    expect(await rows.count()).toBeGreaterThan(3);
    await expect(rows.first()).toContainText('via index.ts');
    // A component that takes a workstream type from the barrel is among them.
    await expect(through.getByRole('button').filter({ hasText: 'src/frontend/lib/workstream-strip.ts' })).toContainText('Workstream');

    fs.mkdirSync(OUT, { recursive: true });
    await inspector.getByText(/^Used through re-exports/).scrollIntoViewIfNeeded();
    await page.waitForTimeout(300);
    await page.screenshot({ path: path.join(OUT, 'inspector-reexports.png') });
  });
});
