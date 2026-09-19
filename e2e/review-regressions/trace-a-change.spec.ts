/**
 * Tracing a change: from a file, to the item that wants it, to the plan.
 *
 * Raised from using the app. Reading a file in Code mode showed
 * "Rework the ledger wants this file" — styled as a button, with hover
 * feedback — and clicking it did nothing, because no caller ever supplied
 * the `onOpenItem` prop it was wired to. And nothing on the row said
 * whether the plan meant to CREATE the file or change it: the intent was
 * encoded as the colour of a 4px triangle.
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test, expect, type Page } from '@playwright/test';
import { gotoWithProject } from '../helpers/setup';

const API = 'http://localhost:3001/api';
const PROJECT_PATH = path.resolve(process.cwd(), 'tests/fixtures/sample-app');
const TARGET = 'services/shared-go/money/money.go';

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

async function seedPlanTouching(page: Page, action: 'create' | 'modify' | 'delete', title: string) {
  const planRes = await page.request.post(`${API}/plans`, {
    headers: authHeaders(),
    data: { title, description: '', projectPath: PROJECT_PATH },
  });
  expect(planRes.ok(), `POST /api/plans -> ${planRes.status()}`).toBeTruthy();
  const plan = (await planRes.json()) as { uid: string };

  const itemRes = await page.request.post(`${API}/plans/${plan.uid}/items`, {
    headers: authHeaders(),
    data: {
      kind: 'action',
      title: 'Rework the ledger',
      // `action`, not `intent` — `FileSpecAction` is the canonical field
      // and the overlay reads `spec.action`. An item written with the
      // wrong key renders as the generic "planned", which is exactly the
      // "I cannot tell a new file from a change" complaint.
      fileSpecs: [{ path: TARGET, action }],
    },
  });
  expect(itemRes.ok(), `POST items -> ${itemRes.status()}`).toBeTruthy();
  const item = (await itemRes.json()) as { uid: string };
  return { plan, item };
}

test.describe('Trace a change from the code', () => {
  test.setTimeout(90_000);

  test('the overlay says what the plan means to do to this file', async ({ page }) => {
    await gotoWithProject(page, { projectPath: PROJECT_PATH });
    const { plan } = await seedPlanTouching(page, 'create', 'Trace create');

    try {
      await page.getByRole('button', { name: 'Code', exact: true }).click();
      const surface = page.locator('div.absolute.inset-0.z-30.bg-background');
      await surface.getByRole('button', { name: 'Source', exact: true }).waitFor({ timeout: 10_000 });

      // Navigate to the file the plan touches.
      // The tree arrives already expanded a couple of levels, so
      // `services` is open and clicking it would COLLAPSE it and take
      // `shared-go` away again. Only the levels that are still closed
      // need a click.
      for (const dir of ['shared-go', 'money']) {
        await surface.getByRole('button', { name: new RegExp(`^${dir}(\\s|$)`) }).first()
          .click({ timeout: 10_000 });
      }
      await surface.getByRole('button', { name: /^money\.go/ }).first()
        .click({ timeout: 10_000 });

      const banner = surface.getByRole('button', { name: /Rework the ledger/ }).first();
      await banner.waitFor({ timeout: 15_000 });
      // The question a reader actually has, answered in words rather than
      // in the colour of a triangle.
      await expect(banner).toContainText(/new file/i);
    } finally {
      await page.request.delete(`${API}/plans/${plan.uid}`, { headers: authHeaders() });
    }
  });

  test('clicking the item opens it in the plan workspace', async ({ page }) => {
    await gotoWithProject(page, { projectPath: PROJECT_PATH });
    const { plan } = await seedPlanTouching(page, 'modify', 'Trace modify');

    try {
      await page.getByRole('button', { name: 'Code', exact: true }).click();
      const surface = page.locator('div.absolute.inset-0.z-30.bg-background');
      await surface.getByRole('button', { name: 'Source', exact: true }).waitFor({ timeout: 10_000 });

      // The tree arrives already expanded a couple of levels, so
      // `services` is open and clicking it would COLLAPSE it and take
      // `shared-go` away again. Only the levels that are still closed
      // need a click.
      for (const dir of ['shared-go', 'money']) {
        await surface.getByRole('button', { name: new RegExp(`^${dir}(\\s|$)`) }).first()
          .click({ timeout: 10_000 });
      }
      await surface.getByRole('button', { name: /^money\.go/ }).first()
        .click({ timeout: 10_000 });

      const banner = surface.getByRole('button', { name: /Rework the ledger/ }).first();
      await banner.waitFor({ timeout: 15_000 });
      await expect(banner).toContainText(/modify/i);

      await banner.click();

      // The plan workspace comes to the front with that item selected —
      // "bring up the task", which is what the button looked like it did
      // and did not.
      await expect(page.getByRole('heading', { name: 'Trace modify' }).or(page.getByText('Trace modify')).first())
        .toBeVisible({ timeout: 15_000 });
      await expect(page.getByText('Rework the ledger').first()).toBeVisible();
      // And we are no longer in the code surface.
      await expect(page.locator('div.absolute.inset-0.z-30.bg-background')
        .getByRole('button', { name: 'Source', exact: true })).toHaveCount(0);
    } finally {
      await page.request.delete(`${API}/plans/${plan.uid}`, { headers: authHeaders() });
    }
  });
});
