/**
 * Line changes in the code view (Phase 32 B3.2), the journey.
 *
 * Sam opens validators.ts. Two other workstreams change it: billing-v2
 * inside validateCreateOrder (not committed) and exports inside
 * validateCreateUser. The strip above the code names both with their line
 * counts; the gutter marks their lines, and hovering one says who, which
 * lines, which function and whether it is committed. "Compare with…
 * billing-v2" opens its copy against this one, both sides named. A file no
 * one else changes says so.
 *
 * The line changes and the other copies are given, so what is drawn is exact;
 * the backend's side is tests/e2e/line-changes.test.ts.
 */

import fs from 'node:fs';
import path from 'node:path';
import { test, expect } from '@playwright/test';
import { gotoWithProject } from '../helpers/setup';
import { createMcpClient } from '../helpers/mcp-client';
import { FIXTURE_PATH } from '../live-agent/helpers/fixture-reset';

const OUT = path.join('test-results', 'ux-audit');
const FILE = 'packages/shared/src/validators.ts';
const OTHER = 'packages/shared/src/types.ts';

const hunk = (kind: string, o: [number, number], n: [number, number], functions: string[], committed: boolean) =>
  ({ kind, old: { start: o[0], lines: o[1] }, new: { start: n[0], lines: n[1] }, functions, committed });

const CHANGES = [
  {
    workstream: `${FIXTURE_PATH}-billing`, branch: 'billing-v2', path: FILE, status: 'changed', added: 3, removed: 2,
    hunks: [hunk('changed', [18, 2], [18, 3], ['validateCreateOrder'], false)],
  },
  {
    workstream: `${FIXTURE_PATH}-exports`, branch: 'exports', path: FILE, status: 'changed', added: 1, removed: 0,
    hunks: [hunk('added', [12, 0], [13, 1], ['validateCreateUser'], true)],
  },
];

async function openFile(rel: string) {
  const client = await createMcpClient();
  try {
    await client.callTool('navigate_to', { target: 'code', file_path: path.join(FIXTURE_PATH, rel) });
  } finally {
    client.close();
  }
}

test.describe('Line changes in the code view', () => {
  test('others\' lines in the gutter, named in words; compare with their copy; a file no one else changes says so', async ({ page }) => {
    await page.route('**/api/workstreams/changes?*', (route) => {
      const url = new URL(route.request().url());
      const body = url.searchParams.get('path') === FILE ? { path: FILE, changes: CHANGES } : { path: url.searchParams.get('path'), changes: [] };
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) });
    });
    const original = fs.readFileSync(path.join(FIXTURE_PATH, FILE), 'utf-8');
    await page.route((url) => url.pathname === '/api/file/at' && (url.searchParams.get('at') ?? '').startsWith('workstream:'), (route) => {
      const at = new URL(route.request().url()).searchParams.get('at')!.slice('workstream:'.length);
      const content = at === 'billing-v2'
        ? original.replace("  return errors;\n}\n\nexport function validateCreateOrder", "  return errors;\n}\n\nexport function validateCreateOrder")
          .replace("errors.push('amount must be a positive number');", "errors.push('amount must be a positive number');\n  if (!payload.currency) errors.push('currency is required');")
        : original;
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true, content, label: at }) });
    });

    await gotoWithProject(page, { projectPath: FIXTURE_PATH });
    await openFile(FILE);
    const code = page.locator(`[data-code-file$="${FILE}"]`).first();
    await expect(code).toBeVisible({ timeout: 10_000 });

    // The strip names both, with their counts, and that billing's is not committed.
    const strip = page.getByTestId('code-workstreams');
    await expect(strip.getByTestId('code-other')).toHaveText(['billing-v2 ＋3 −2 · not committed', 'exports ＋1']);
    await expect(strip.getByTestId('code-other').first()).toHaveAttribute('title', 'billing-v2: 3 lines added, 2 removed, some not committed. Compare its copy with this one.');

    // The gutter: billing's run on 18–19, exports' insertion after line 12.
    const other = (n: number) => code.locator(`[data-line="${n}"]`).getByTestId('work-mark-other');
    await expect(other(18)).toHaveAttribute('data-who', 'billing-v2');
    await expect(other(19)).toHaveAttribute('data-who', 'billing-v2');
    await expect(other(18)).toHaveAttribute('title', 'billing-v2 changed 18–20, in validateCreateOrder, not committed');
    await expect(other(12)).toHaveAttribute('title', 'exports added line 13, in validateCreateUser');
    await expect(code.getByTestId('work-mark-other')).toHaveCount(3);
    // This copy changes nothing here: no marks of its own.
    await expect(code.getByTestId('work-mark-own')).toHaveCount(0);
    fs.mkdirSync(OUT, { recursive: true });
    await page.locator('[data-code-file]').first().locator('..').screenshot({ path: path.join(OUT, 'code-workstream-gutter.png') });

    // Compare with… billing-v2: its copy before, this one after, both named.
    await strip.getByTestId('compare-with').selectOption('billing-v2');
    // The diff editor is loaded on first use; give it the time the other code-mode specs do.
    await expect(page.getByText(/Loading the diff editor/)).toHaveCount(0, { timeout: 45_000 });
    await expect(page.getByText(/^billing-v2 → this copy/)).toBeVisible({ timeout: 10_000 });
    await page.screenshot({ path: path.join(OUT, 'code-compare-with.png') });

    // A file no one else changes says so.
    await openFile(OTHER);
    await expect(page.locator(`[data-code-file$="${OTHER}"]`).first()).toBeVisible({ timeout: 10_000 });
    await expect(page.getByTestId('code-no-others')).toHaveText('No other workstream changes this file.');
  });
});
