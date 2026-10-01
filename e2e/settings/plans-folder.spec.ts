/**
 * Where a project's plans live, from the window (Phase 32 C3.4a).
 *
 * Dana opens Settings → Plans folder. The plans live in the project. She
 * chooses "A planning repository", gives its remote and saves it for the
 * team: the section says the plans now live there and that she must link her
 * copy before anything is read. She gives a folder that is the wrong
 * repository and is told why; then her clone, and the section shows it
 * linked, with Unlink.
 *
 * The answers are served (the backend's side, two machines and git between
 * them, with the grant rule, is tests/e2e/plans-folder.test.ts).
 */

import fs from 'node:fs';
import path from 'node:path';
import { test, expect, type Page } from '@playwright/test';
import { gotoWithProject } from '../helpers/setup';

const OUT = path.join('test-results', 'ux-audit');
const REMOTE = 'git@github.com:acme/plans.git';
const COPY = '/Users/dana/work/acme-plans';
const HERE = "This project's plans live in the project itself, under .codetrellis/plans.";
const UNLINKED = "This project's plans live in the planning repository github.com/acme/plans. Link your copy of it on this device to see them; until then nothing there is read.";
const LINKED = `This project's plans live in the planning repository github.com/acme/plans. On this device that is ${COPY}.`;
const WRONG = '/Users/dana/work/website is not the planning repository github.com/acme/plans: its remote is github.com/acme/website, not github.com/acme/plans.';

async function serve(page: Page) {
  let named: unknown = null;
  let linked = false;
  const sent: Array<{ method: string; url: string; body: unknown }> = [];
  const status = () => ({
    project: '/work/board-pack', named,
    state: !named ? 'here' : linked ? 'linked' : 'unlinked',
    linked: linked ? { path: COPY, confirmedAt: Date.UTC(2026, 9, 1, 9), confirmedBy: 'dana@acme.test' } : null,
    says: !named ? HERE : linked ? LINKED : UNLINKED,
  });
  await page.route('**/api/plans-folder**', async (route) => {
    const req = route.request();
    const body = req.method() === 'GET' || req.method() === 'DELETE' ? null : req.postDataJSON() as Record<string, unknown>;
    sent.push({ method: req.method(), url: new URL(req.url()).pathname, body });
    if (req.method() === 'PUT') named = (body as { folder: unknown }).folder;
    if (req.method() === 'POST') {
      if ((body as { path: string }).path !== COPY) {
        await route.fulfill({ status: 400, contentType: 'application/json', body: JSON.stringify({ error: WRONG }) });
        return;
      }
      linked = true;
    }
    if (req.method() === 'DELETE') linked = false;
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(status()) });
  });
  return sent;
}

test.describe('Plans folder', () => {
  test('the plans move to a planning repository; this device links its copy, and a wrong folder is refused saying why', async ({ page }) => {
    const sent = await serve(page);
    await page.setViewportSize({ width: 1280, height: 1000 });
    await gotoWithProject(page);
    await page.locator('button[title*="Settings"]').click();
    const dialog = page.getByRole('dialog', { name: 'Settings' });
    await dialog.getByRole('button', { name: 'Plans folder', exact: true }).click();
    const section = dialog.getByTestId('plans-folder-section');

    await expect(section.getByTestId('plans-folder-says')).toHaveText(HERE);
    await expect(section.getByTestId('plans-folder-save')).toBeDisabled();
    await expect(section.getByTestId('plans-folder-device')).toHaveCount(0);

    await section.getByTestId('plans-folder-kind-git').check();
    await section.getByTestId('plans-folder-remote').fill(REMOTE);
    await section.getByTestId('plans-folder-save').click();
    await expect(section.getByTestId('plans-folder-says')).toHaveText(UNLINKED);
    await expect(section.getByTestId('plans-folder-says')).toHaveAttribute('data-state', 'unlinked');
    const device = section.getByTestId('plans-folder-device');
    await expect(device).toContainText('Clone the planning repository if you have not, then give the folder it is in.');

    await device.getByTestId('plans-folder-path').fill('/Users/dana/work/website');
    await device.getByTestId('plans-folder-link').click();
    await expect(section.getByTestId('plans-folder-error')).toHaveText(WRONG);
    fs.mkdirSync(OUT, { recursive: true });
    await dialog.screenshot({ path: path.join(OUT, 'plans-folder-unlinked.png') });

    await device.getByTestId('plans-folder-path').fill(COPY);
    await device.getByTestId('plans-folder-link').click();
    await expect(section.getByTestId('plans-folder-says')).toHaveText(LINKED);
    await expect(device.getByTestId('plans-folder-linked')).toHaveText(COPY);
    await expect(section.getByTestId('plans-folder-error')).toHaveCount(0);
    await dialog.screenshot({ path: path.join(OUT, 'plans-folder-linked.png') });

    expect(sent.filter((s) => s.method !== 'GET')).toEqual([
      { method: 'PUT', url: '/api/plans-folder', body: { folder: { kind: 'git', remote: REMOTE } } },
      { method: 'POST', url: '/api/plans-folder/link', body: { path: '/Users/dana/work/website' } },
      { method: 'POST', url: '/api/plans-folder/link', body: { path: COPY } },
    ]);

    await device.getByTestId('plans-folder-unlink').click();
    await expect(section.getByTestId('plans-folder-says')).toHaveText(UNLINKED);
  });

  test('a synced folder is named by its place, the same for everyone', async ({ page }) => {
    const sent = await serve(page);
    await gotoWithProject(page);
    await page.locator('button[title*="Settings"]').click();
    const dialog = page.getByRole('dialog', { name: 'Settings' });
    await dialog.getByRole('button', { name: 'Plans folder', exact: true }).click();
    const section = dialog.getByTestId('plans-folder-section');
    await section.getByTestId('plans-folder-kind-synced').check();
    await section.getByTestId('plans-folder-provider').selectOption('sharepoint');
    await section.getByTestId('plans-folder-place').fill('Acme/Board pack');
    await section.getByTestId('plans-folder-save').click();
    await expect(section.getByTestId('plans-folder-device')).toContainText('Give the folder where your sync client keeps it.');
    expect(sent.find((s) => s.method === 'PUT')?.body).toEqual({ folder: { kind: 'synced', provider: 'sharepoint', place: 'Acme/Board pack' } });
  });
});
