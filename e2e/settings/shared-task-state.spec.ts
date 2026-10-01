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
 * C3.3: the section says how this device signs its records and shows its
 * fingerprint. Sam's device has introduced its key: Dana checks the
 * fingerprint with him and trusts it, and his record on the report now reads
 * "in their signed record", with whose key on hover.
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

const MINE = 'SHA256:q2v8Lx0Hc4mZ7rT1bN5wK9pE3sY6uA0dF2gJ8hR4tVk';
const SAMS = 'SHA256:Wm3kP7xQ1zL9cV5bN2hT8rY4uE6sA0dF3gJ1kM7pQ2w';
const SIGNING = {
  how: 'device', as: MINE,
  says: `Records written here are signed with this device's own key (${MINE.slice(0, 19)}…). Teammates trust it once, in their Settings, after checking that fingerprint with you.`,
};
const samKey = (trusted: boolean) => ({
  writer: 'aaaaaaaa11112222', name: 'Sam Lee', fingerprint: SAMS, short: SAMS.slice(0, 19), state: trusted ? 'trusted' : 'new',
  firstSeen: Date.UTC(2026, 9, 1, 9), decidedAt: trusted ? Date.UTC(2026, 9, 1, 10) : null, decidedBy: trusted ? 'dana@acme.test' : null, replaces: false,
});
const NOT_TRUSTED = "it is signed with Sam Lee's device key, which you have not trusted yet";

const state = (enabled: boolean, trusted = false) => ({
  project: '/work/board-pack', enabled, changedAt: enabled ? Date.now() : null, changedBy: enabled ? 'dana@acme.test' : null,
  writer: '3f9c2e1a7b4d5e6f', name: 'Dana Ortiz', records: 3, writers: 2, says: enabled ? ON : OFF,
  signing: SIGNING, keys: enabled ? [samKey(trusted)] : [],
  checked: enabled
    ? (trusted ? { verified: 2, unverified: 0, reasons: [] } : { verified: 0, unverified: 2, reasons: [{ why: NOT_TRUSTED, records: 2 }] })
    : { verified: 0, unverified: 0, reasons: [] },
});

async function serve(page: Page, start = { enabled: false }) {
  let enabled = start.enabled;
  let trusted = false;
  const sent: unknown[] = [];
  await page.route('**/api/shared-task-state?*', async (route) => {
    if (route.request().method() === 'PUT') {
      const body = route.request().postDataJSON() as { enabled: boolean };
      sent.push(body);
      enabled = body.enabled;
    }
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(state(enabled, trusted)) });
  });
  await page.route('**/api/shared-task-state/keys', async (route) => {
    const body = route.request().postDataJSON() as { trust: boolean };
    sent.push(body);
    trusted = body.trust;
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ key: samKey(trusted), rechecked: [] }) });
  });
  return sent;
}

async function openSection(page: Page) {
  await page.locator('button[title*="Settings"]').click();
  const dialog = page.getByRole('dialog', { name: 'Settings' });
  await dialog.getByRole('button', { name: 'Shared task state', exact: true }).click();
  return { dialog, section: dialog.getByTestId('shared-state-section') };
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
    await expect(section.getByTestId('shared-state-trust')).toContainText('reads “in their record, unverified” unless it is signed with a key you trust here');
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

  test('C3.3: the section says how this device signs, and Dana trusts Sam\'s key after checking its fingerprint', async ({ page }) => {
    const sent = await serve(page, { enabled: true });
    await page.setViewportSize({ width: 1280, height: 1000 });
    await gotoWithProject(page);
    const { dialog, section } = await openSection(page);
    await expect(section.getByTestId('shared-state-signing-says')).toHaveText(SIGNING.says);
    await expect(section.getByTestId('shared-state-fingerprint')).toHaveText(MINE);

    const key = section.getByTestId('shared-state-key');
    await expect(key).toHaveAttribute('data-state', 'new');
    await expect(key).toContainText('Sam Lee');
    await expect(key.getByTestId('shared-state-key-says')).toHaveText(`New. Check that Sam Lee's Settings shows ${SAMS.slice(0, 19)}… before trusting it; until then their records read unverified.`);
    await expect(section.getByTestId('shared-state-checked')).toHaveText(`Teammates' records here: 0 signed and verified, 2 unverified: ${NOT_TRUSTED}.`);
    fs.mkdirSync(OUT, { recursive: true });
    await dialog.screenshot({ path: path.join(OUT, 'shared-task-state-keys.png') });

    await key.getByTestId('shared-state-key-trust').click();
    await expect(key).toHaveAttribute('data-state', 'trusted');
    await expect(key.getByTestId('shared-state-key-says')).toContainText('records this key signs read as Sam Lee\'s.');
    await expect(key.getByTestId('shared-state-key-refuse')).toHaveText('Stop trusting');
    await expect(section.getByTestId('shared-state-checked')).toHaveText('Teammates\' records here: 2 signed and verified.');
    await dialog.screenshot({ path: path.join(OUT, 'shared-task-state-key-trusted.png') });
    expect(sent).toEqual([{ writer: 'aaaaaaaa11112222', fingerprint: SAMS, trust: true }]);
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
    await expect(recorded).toHaveAttribute('data-verified', 'false');
    fs.mkdirSync(OUT, { recursive: true });
    await state.locator('..').screenshot({ path: path.join(OUT, 'shared-task-state-line.png') });
  });

  test('C3.3: a teammate\'s record that verified reads "in their signed record", with whose key on hover', async ({ page, request }) => {
    const plan = await seedPlan(request, { title: PLAN, actions: [{ title: 'Write the board report' }] });
    const write = plan.actionUids[0];
    const at = Date.UTC(2026, 9, 1, 11, 15);
    const line = { itemUid: write, title: 'Write the board report', words: 'in progress, 60%', source: 'plan', from: 'from the plan' };
    const check = { verified: true, claimed: 'Sam Lee', how: 'device', who: 'Sam Lee', author: 'Sam Lee' };
    const STATUS = {
      planUid: plan.uid, title: PLAN, base: null,
      items: [{ ...line, kind: 'action', state: 'in-progress', recorded: { by: 'Sam Lee', byType: 'record', at, check }, branch: null }],
      progress: { done: 0, total: 1, words: '0 of 1 task done' },
      waiting: [], inProgress: [line], lineage: [], updatedAt: at,
    };
    await page.route(`**/api/plans/${plan.uid}/status`, (route) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(STATUS) }));
    await gotoWithProject(page);
    await openPlan(page, PLAN);
    await page.getByText('Write the board report', { exact: true }).first().click();
    const recorded = page.getByTestId('item-state-line').getByTestId('item-state-recorded');
    await expect(recorded).toHaveText('recorded by Sam Lee in their signed record, 1 Oct');
    await expect(recorded).toHaveAttribute('data-verified', 'true');
    await expect(recorded).toHaveAttribute('title', "Signed with Sam Lee's device key, which you trusted in Settings → Shared task state.");
    fs.mkdirSync(OUT, { recursive: true });
    await page.getByTestId('item-state-line').locator('..').screenshot({ path: path.join(OUT, 'shared-task-state-signed-line.png') });
  });

  test('C3.2: a task set two ways at once names both, and Keep settles it with a new record', async ({ page, request }) => {
    const plan = await seedPlan(request, { title: PLAN, actions: [{ title: 'Check the figures' }] });
    const check = plan.actionUids[0];
    const at = Date.UTC(2026, 9, 1, 10, 5);
    const claims = [{ name: 'Sam Lee', status: 'in_progress', at }, { name: 'Dana Ortiz', status: 'blocked', at: at - 60_000 }];
    const words = 'set two ways at once: Sam Lee says in progress, Dana Ortiz says blocked';
    let kept = false;
    const statusNow = () => {
      const line = { itemUid: check, title: 'Check the figures', words: kept ? 'blocked: waits on the ledger' : `blocked: waits on the ledger; ${words}`, source: 'plan', from: 'from the plan' };
      return {
        planUid: plan.uid, title: PLAN, base: null,
        items: [{
          itemUid: check, title: 'Check the figures', kind: 'action', state: 'blocked', source: 'plan', from: 'from the plan',
          words: 'blocked: waits on the ledger', recorded: { by: 'dana@acme.test', byType: 'human', at }, branch: null,
          ...(kept ? {} : { atOnce: { words, claims } }),
        }],
        progress: { done: 0, total: 1, words: '0 of 1 task done' },
        waiting: [line], inProgress: [], lineage: [], updatedAt: at,
      };
    };
    await page.route(`**/api/plans/${plan.uid}/status`, (route) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(statusNow()) }));
    await page.route(`**/api/items/${check}/keep-state`, async (route) => {
      kept = true;
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ settled: true, record: '3f9c2e1a7b4d5e6f-2.yaml' }) });
      await page.evaluate(() => window.dispatchEvent(new CustomEvent('awareness-changed')));
    });

    await gotoWithProject(page);
    await openPlan(page, PLAN);
    await page.getByText('Check the figures', { exact: true }).first().click();
    const banner = page.getByTestId('item-state-at-once');
    await expect(banner).toContainText('⚠ Set two ways at once: Sam Lee says in progress, Dana Ortiz says blocked.');
    const keep = banner.getByTestId('item-state-keep');
    await expect(keep).toHaveText('Keep “blocked: waits on the ledger”');
    await expect(banner).toContainText('or set the state you want.');
    fs.mkdirSync(OUT, { recursive: true });
    await page.getByTestId('item-state-line').locator('..').screenshot({ path: path.join(OUT, 'state-split-banner.png') });

    await keep.click();
    await expect(banner).toHaveCount(0);
    expect(kept).toBe(true);
  });
});
