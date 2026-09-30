/**
 * Phase 32 HD3 — business clashes in the Stack, from the window.
 *
 * Dana leads a finance team. The Q3 board pack and the forecast refresh are
 * two plans, each with a Claude Desktop task working from the sales
 * workbook. The Stack tab carries "⚠ overlaps" on both, saying they rely on
 * the same workbook and what is open between them; each task says which
 * version it read. Replaying to Monday, each task says the version it had
 * read then, before the workbook was replaced.
 *
 * The stacks are served (the backend's side, on a real workbook, is
 * tests/e2e/stack-materials.test.ts), so the screen is tested on a known
 * morning.
 */

import fs from 'node:fs';
import path from 'node:path';
import { test, expect, type Page } from '@playwright/test';
import { gotoWithProject } from '../helpers/setup';
import type { Stack, StackOverlap, StackPlan, StackRead, StackTask } from '../../src/shared/types/stack';

const OUT = path.join('test-results', 'ux-audit');
const MIN = 60_000;
const now = Date.now();
const BOOK = 'finance/sales-2026.xlsx';
const OLD = '3f9c2e1a7b4d5e6f708192a3b4c5d6e7f8091a2b3c4d5e6f708192a3b4c5d6e7';
const NEW = 'a7d3f4e8a1b6c0d9e2f3a4b5c6d7e8f909c1e5b2a7d3f4e8a1b6c0d9e2f3a4b5';

const read = (sha: string, words: string): StackRead => ({ path: BOOK, sha256: sha, at: now - 40 * MIN, words });
const task = (over: Partial<StackTask> & Pick<StackTask, 'uid' | 'title'>): StackTask => ({
  parentUid: null, kind: 'action', status: 'in_progress', assignee: 'claude-desktop', assigneeType: 'agent', assigneeSession: null,
  workstream: null, ticketKey: null, files: [], dependencies: [], waits: null, reads: [], ...over,
});
const plan = (over: Partial<StackPlan> & Pick<StackPlan, 'uid' | 'title' | 'tasks'>): StackPlan => ({
  status: 'in_progress', ticketKey: null, label: over.title, progress: { done: 0, total: over.tasks.length }, needsYou: 0, overlaps: [], ...over,
});
const band = (withPlanUid: string, withLabel: string, open: boolean, when: 'now' | 'then'): StackOverlap => ({
  withPlanUid, withLabel, high: false,
  declared: { files: [], symbols: [], materials: [BOOK] },
  actual: open ? [{ id: 's-split', kind: 'version-split', severity: 'medium', summary: 'Two tasks are working from different versions of sales-2026.xlsx' }] : [],
  words: `⚠ overlaps ${withLabel}`,
  detail: `Both rely on sales-2026.xlsx.${open ? ` Open ${when}: Two tasks are working from different versions of sales-2026.xlsx` : ''}`,
});

const stackWith = (boardSha: string, open: boolean, when: 'now' | 'then'): Stack => ({
  project: '/work/finance',
  plans: [
    plan({
      uid: 'p-board', title: 'Q3 board pack',
      tasks: [task({ uid: 't-board', title: 'Board figures', reads: [read(boardSha, `read sales-2026.xlsx on 29 Sept (version ${boardSha.slice(0, 7)})`)] })],
      overlaps: [band('p-forecast', 'Forecast refresh', open, when)],
    }),
    plan({
      uid: 'p-forecast', title: 'Forecast refresh',
      tasks: [task({ uid: 't-forecast', title: 'Refresh the forecast', reads: [read(OLD, `read sales-2026.xlsx on 29 Sept (version ${OLD.slice(0, 7)})`)] })],
      overlaps: [band('p-board', 'Q3 board pack', open, when)],
    }),
  ],
});

const LIVE = stackWith(NEW, true, 'now');
const MONDAY = stackWith(OLD, false, 'then');
const FRAME = { id: 31, at: now - 45 * MIN, reasons: ['status'], ref: null, sessionId: null, agentType: null, workstreamRoot: null, commitSha: null, branch: 'main', sameAs: null, fileCount: 1, edgeCount: 0 };

async function serve(page: Page) {
  const json = (body: unknown) => ({ status: 200, contentType: 'application/json', body: JSON.stringify(body) });
  await page.route('**/api/stack?*', (r) => r.fulfill(json(LIVE)));
  await page.route('**/api/replay/frames?*', (r) => r.fulfill(json({ frames: [FRAME] })));
  await page.route('**/api/replay/state?*', (r) => r.fulfill(json({
    at: Number(new URL(r.request().url()).searchParams.get('at')), projectPath: '/work/finance', frame: FRAME, sinceFrame: null, tasks: [], signals: [], waiting: [], stack: MONDAY,
  })));
  await page.route(/\/api\/trellis\/31$/, (r) => r.fulfill(json({ id: 31, data: { files: [], edges: [] } })));
}

async function shot(page: Page, name: string) {
  fs.mkdirSync(OUT, { recursive: true });
  await page.waitForTimeout(300);
  await page.screenshot({ path: path.join(OUT, `${name}.png`) });
}

test('two finance plans meet over a shared workbook in the Stack tab; each task says which version it read, then and now', async ({ page }) => {
  await serve(page);
  await gotoWithProject(page);

  await page.getByRole('button', { name: 'Stack', exact: true }).first().click();
  const row = (uid: string) => page.locator(`[data-testid="stack-plan"][data-plan-uid="${uid}"]`);
  await expect(row('p-board')).toBeVisible({ timeout: 10_000 });

  // Both plans carry the band, in words, and say what they share and what is open.
  const fromBoard = row('p-board').locator('[data-testid="stack-overlap"][data-with-plan-uid="p-forecast"]');
  await expect(fromBoard).toHaveText('⚠ overlaps Forecast refresh');
  await expect(fromBoard).toHaveAttribute('title', 'Both rely on sales-2026.xlsx. Open now: Two tasks are working from different versions of sales-2026.xlsx');
  await expect(row('p-forecast').locator('[data-testid="stack-overlap"][data-with-plan-uid="p-board"]')).toHaveText('⚠ overlaps Q3 board pack');
  // Said on the row, not only on hover.
  await expect(row('p-board').getByTestId('stack-overlap-detail')).toHaveText('Both rely on sales-2026.xlsx. Open now: Two tasks are working from different versions of sales-2026.xlsx');

  // Each task: the version it worked from.
  await expect(row('p-board').getByTestId('stack-reads')).toHaveText(`read sales-2026.xlsx on 29 Sept (version ${NEW.slice(0, 7)})`);
  await expect(row('p-forecast').getByTestId('stack-reads')).toHaveText(`read sales-2026.xlsx on 29 Sept (version ${OLD.slice(0, 7)})`);
  // Room for both plans, as a person would make it.
  const panel = page.getByTestId('stack-tab').locator('xpath=ancestor::div[.//button[@title="Expand panel"]][1]');
  await panel.getByTitle('Expand panel').click();
  await shot(page, 'stack-materials');
  await panel.getByTitle('Collapse panel').click();

  // Replaying to before the replacement: nothing open yet, both on the old version.
  await page.getByRole('button', { name: /^Timeline( \d+)?$/ }).first().click();
  await page.getByTestId('replay-start').click();
  await expect(page.getByTestId('replay-bar')).toBeVisible();
  await page.getByRole('button', { name: 'Stack', exact: true }).first().click();
  await expect(page.getByTestId('stack-then')).toBeVisible();
  await expect(row('p-board').getByTestId('stack-reads')).toHaveText(`read sales-2026.xlsx on 29 Sept (version ${OLD.slice(0, 7)})`);
  await expect(row('p-board').getByTestId('stack-overlap-detail')).toHaveText('Both rely on sales-2026.xlsx.');
  await panel.getByTitle('Expand panel').click();
  await shot(page, 'stack-materials-then');
  await panel.getByTitle('Collapse panel').click();

  await page.getByTestId('replay-live').click();
  await expect(row('p-board').getByTestId('stack-reads')).toContainText(NEW.slice(0, 7));
});
