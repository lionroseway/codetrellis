/**
 * A shared plans folder, from the window (Phase 32 C3.6, the C3 done-when).
 *
 * Dana's team keeps "Q4 board pack" in its OneDrive folder. On her machine:
 * the report Sam is writing says how far it has got, recorded by Sam in his
 * signed record; "Check the figures", which they both changed at once, names
 * both until one keeps theirs; and the Awareness tab says her report worked
 * from last week's sales export while Sam's figures have the one he put
 * there, naming him.
 *
 * The answers are served. The backend's side, two machines and a synced
 * folder between them, is tests/e2e/shared-folder-journey.test.ts.
 */

import fs from 'node:fs';
import path from 'node:path';
import { test, expect, type Page } from '@playwright/test';
import { gotoWithProject, openPlan, seedPlan, cleanupPlans } from '../helpers/setup';
import type { AwarenessSignal } from '../../src/shared/types';

const OUT = path.join('test-results', 'ux-audit');
const PLAN = 'E2E C3.6 Q4 board pack';
const now = Date.now();

async function shot(page: Page, name: string, target?: ReturnType<Page['getByTestId']>) {
  fs.mkdirSync(OUT, { recursive: true });
  await page.waitForTimeout(300);
  await (target ?? page).screenshot({ path: path.join(OUT, `${name}.png`) });
}

test.describe('A shared plans folder', () => {
  test.use({ viewport: { width: 1440, height: 900 } });
  test.afterEach(async ({ request }) => { await cleanupPlans(request, PLAN); });

  test('Dana\'s plan: Sam\'s progress in his signed record, and a task changed two ways at once', async ({ page, request }) => {
    const plan = await seedPlan(request, { title: PLAN, actions: [{ title: 'Write the board report' }, { title: 'Check the figures' }] });
    const [report, figures] = plan.actionUids;
    const at = Date.UTC(2026, 9, 1, 11, 15);
    const check = { verified: true, claimed: 'Sam Lee', how: 'device', who: 'Sam Lee', author: 'Sam Lee' };
    const words = 'set two ways at once: Sam Lee says in progress, Dana Ortiz says blocked';
    const reportLine = { itemUid: report, title: 'Write the board report', words: 'in progress, 60%', source: 'plan', from: 'from the plan' };
    const figuresLine = { itemUid: figures, title: 'Check the figures', words: `blocked: waits on the ledger; ${words}`, source: 'plan', from: 'from the plan' };
    const STATUS = {
      planUid: plan.uid, title: PLAN, base: null,
      items: [
        { ...reportLine, kind: 'action', state: 'in-progress', recorded: { by: 'Sam Lee', byType: 'record', at, check }, branch: null },
        {
          itemUid: figures, title: 'Check the figures', kind: 'action', state: 'blocked', source: 'plan', from: 'from the plan',
          words: 'blocked: waits on the ledger', recorded: { by: 'dana@acme.test', byType: 'human', at }, branch: null,
          atOnce: { words, claims: [{ name: 'Sam Lee', status: 'in_progress', at }, { name: 'Dana Ortiz', status: 'blocked', at: at - 60_000 }] },
        },
      ],
      progress: { done: 0, total: 2, words: '0 of 2 tasks done' },
      waiting: [figuresLine], inProgress: [reportLine], lineage: [], updatedAt: at,
    };
    await page.route(`**/api/plans/${plan.uid}/status`, (route) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(STATUS) }));

    await gotoWithProject(page);
    await openPlan(page, PLAN);
    await page.getByText('Write the board report', { exact: true }).first().click();
    const recorded = page.getByTestId('item-state-line').getByTestId('item-state-recorded');
    await expect(recorded).toHaveText('recorded by Sam Lee in their signed record, 1 Oct');
    await shot(page, 'shared-folder-report');

    await page.getByText('Check the figures', { exact: true }).first().click();
    await expect(page.getByTestId('item-state-at-once')).toContainText('⚠ Set two ways at once: Sam Lee says in progress, Dana Ortiz says blocked.');
    await shot(page, 'shared-folder-figures');
  });

  test('the Awareness tab: Dana\'s report used last week\'s export, Sam\'s figures the current one, naming him', async ({ page }) => {
    const report = 'task:r1';
    const figures = 'task:f1';
    const signal: AwarenessSignal = {
      id: 'vs1', kind: 'version-split', severity: 'medium', state: 'open', workstreams: [figures, report],
      subject: {
        material: 'plans://Materials/sales.csv',
        readVersions: { [figures]: 'current', [report]: 'earlier' },
        labels: { [figures]: 'Check the figures', [report]: 'Write the board report' },
        readBy: { [figures]: 'Sam Lee' },
      },
      summary: '“Check the figures” (Sam Lee), “Write the board report” read different versions of `plans://Materials/sales.csv`; “Check the figures” has the current one',
      firstSeen: now - 20 * 60_000, lastSeen: now - 30_000,
    };
    await page.route('**/api/breakpoint-hits', (route) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ hits: [] }) }));
    await page.route('**/api/workstreams?*', (route) => route.fulfill({ status: 200, contentType: 'application/json', body: '[]' }));
    await page.route('**/api/awareness?*', (route) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ signals: [signal] }) }));

    await gotoWithProject(page);
    const tabButton = page.getByRole('button', { name: /^Awareness/ });
    await tabButton.click();
    await tabButton.locator('..').getByRole('button', { name: 'Expand panel' }).click();
    const card = page.getByTestId('awareness-signal').filter({ hasText: 'Different versions' });
    await expect(card).toBeVisible();
    const sides = card.getByTestId('awareness-sides');
    await expect(sides.locator('span.font-mono')).toHaveText(['Check the figures (Sam Lee)', 'Write the board report', 'plans://Materials/sales.csv']);
    await shot(page, 'shared-folder-awareness', card);
  });
});
