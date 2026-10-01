/**
 * Shared task state, from the window (Phase 32 C3.1).
 *
 * Dana opens Settings → Shared task state. It says that who is doing each
 * task stays on this device, and why a teammate's record would be shown as
 * unverified. She shares it: the section says where her records go and the
 * name they carry. Back in "Q4 board pack", the report Sam is writing says
 * "in progress, 40%", recorded by Sam Lee in his record, unverified, with
 * why on hover.
 *
 * The answers are served (the backend's side, two machines and git between
 * them, with the grant rule, is tests/e2e/task-records.test.ts).
 */

import fs from 'node:fs';
import path from 'node:path';
import { test, expect, type Page } from '@playwright/test';
import { gotoWithProject, openPlan, seedPlan, cleanupPlans } from '../helpers/setup';

const OUT = path.join('test-results', 'ux-audit');
const PLAN = 'E2E C3.1 Q4 board pack';
const OFF = 'Off. Task state stays on this device; teammates who pull see the plan, not who is doing what. 3 records from 2 devices are in the project\'s files.';
const ON = 'On: each change to a task\'s state here is written to .codetrellis/records as Dana Ortiz, and teammates\' records are read. 3 records from 2 devices are in the project\'s files.';

const state = (enabled: boolean) => ({
  project: '/work/board-pack', enabled, changedAt: enabled ? Date.now() : null, changedBy: enabled ? 'dana@acme.test' : null,
  writer: '3f9c2e1a7b4d5e6f', name: 'Dana Ortiz', records: 3, writers: 2, says: enabled ? ON : OFF,
});

async function serve(page: Page) {
  let enabled = false;
  const sent: unknown[] = [];
  await page.route('**/api/shared-task-state?*', async (route) => {
    if (route.request().method() === 'PUT') {
      const body = route.request().postDataJSON() as { enabled: boolean };
      sent.push(body);
      enabled = body.enabled;
    }
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(state(enabled)) });
  });
  return sent;
}

test.describe('Shared task state', () => {
  test.afterEach(async ({ request }) => { await cleanupPlans(request, PLAN); });

  test('Settings says what stays on this device and why a teammate\'s record is unverified; shared, where records go', async ({ page }) => {
    const sent = await serve(page);
    await gotoWithProject(page);
    await page.locator('button[title*="Settings"]').click();
    const dialog = page.getByRole('dialog', { name: 'Settings' });
    await dialog.getByRole('button', { name: 'Shared task state', exact: true }).click();

    const section = dialog.getByTestId('shared-state-section');
    await expect(section.getByTestId('shared-state-says')).toHaveText(OFF);
    await expect(section.getByTestId('shared-state-trust')).toContainText('shown as “in their record, unverified” until records are signed');
    await expect(section.getByTestId('shared-state-trust')).toContainText('Nothing is sent from this machine');
    const toggle = section.getByTestId('shared-state-toggle');
    await expect(toggle).toHaveText('Share task state');
    await expect(toggle).toHaveAttribute('aria-pressed', 'false');

    await toggle.click();
    await expect(section.getByTestId('shared-state-says')).toHaveText(ON);
    await expect(toggle).toHaveText('Stop sharing');
    await expect(section.getByTestId('shared-state-writer')).toHaveText('Your records name you as Dana Ortiz (from Settings → Identity) and this device as 3f9c2e1a7b4d5e6f.');
    fs.mkdirSync(OUT, { recursive: true });
    await dialog.screenshot({ path: path.join(OUT, 'shared-task-state-settings.png') });
    expect(sent).toEqual([{ enabled: true }]);
  });

  test('a task whose state came from a teammate\'s record says whose, and that it is unverified', async ({ page, request }) => {
    const plan = await seedPlan(request, { title: PLAN, actions: [{ title: 'Write the board report' }] });
    const write = plan.actionUids[0];
    const at = Date.UTC(2026, 9, 1, 9, 30);
    const line = { itemUid: write, title: 'Write the board report', words: 'in progress, 40%', source: 'plan', from: 'from the plan' };
    const STATUS = {
      planUid: plan.uid, title: PLAN, base: null,
      items: [{ ...line, kind: 'action', state: 'in-progress', recorded: { by: 'Sam Lee', byType: 'record', at }, branch: null }],
      progress: { done: 0, total: 1, words: '0 of 1 task done' },
      waiting: [], inProgress: [line], lineage: [], updatedAt: at,
    };
    await page.route(`**/api/plans/${plan.uid}/status`, (route) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(STATUS) }));

    await gotoWithProject(page);
    await openPlan(page, PLAN);
    await page.getByText('Write the board report', { exact: true }).first().click();
    const state = page.getByTestId('item-state-line');
    await expect(state.getByTestId('item-state-words')).toHaveText('in progress, 40%');
    const recorded = state.getByTestId('item-state-recorded');
    await expect(recorded).toHaveText('recorded by Sam Lee in their record, unverified, 1 Oct');
    await expect(recorded).toHaveAttribute('data-recorded-type', 'record');
    await expect(recorded).toHaveAttribute('title', /could write one in another person's name/);
    fs.mkdirSync(OUT, { recursive: true });
    await state.locator('..').screenshot({ path: path.join(OUT, 'shared-task-state-line.png') });
  });
});
