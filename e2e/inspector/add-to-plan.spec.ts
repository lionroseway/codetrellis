/**
 * "Add to plan" from a code selection, on a V2 plan (Phase 32 §0.4c, bug 21).
 *
 * The popover was built on V1 tasks: on a V2 plan it listed no tasks, and
 * what it created was a V1 task the workspace never shows. Here: select
 * lines in the code reader, attach them to an existing Action, and to a
 * new one — and find both on the Actions themselves.
 */

import path from 'node:path';
import { test, expect } from '@playwright/test';
import { API, authHeaders, gotoWithProject } from '../helpers/setup';
import { createMcpClient } from '../helpers/mcp-client';
import { FIXTURE_PATH } from '../live-agent/helpers/fixture-reset';

const FILE = 'packages/shared/src/validators.ts';

async function api(method: string, url: string, body?: unknown): Promise<any> {
  const res = await fetch(`${API}${url}`, {
    method,
    headers: { 'Content-Type': 'application/json', ...authHeaders() },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`${method} ${url}: ${res.status} ${await res.text()}`);
  return res.json();
}

test.describe('Add to plan from the code reader', () => {
  test('lines attach to an existing Action and to a new one', async ({ page }) => {
    const title = `e2e-add-to-plan-${Date.now()}`;
    const plan = await api('POST', '/plans', { title, projectPath: FIXTURE_PATH });
    const action = await api('POST', `/plans/${plan.uid}/items`, { kind: 'action', title: 'Tighten validation' });

    await gotoWithProject(page, { projectPath: FIXTURE_PATH });
    const client = await createMcpClient();
    try {
      await client.callTool('navigate_to', { target: 'code', file_path: path.join(FIXTURE_PATH, FILE), line: 5 });
    } finally {
      client.close();
    }
    const code = page.locator(`[data-code-file$="${FILE}"]`).first();
    await expect(code).toBeVisible({ timeout: 10_000 });

    // Lines 5–7.
    await code.locator('[data-line="5"]').click();
    await code.locator('[data-line="7"]').click({ modifiers: ['Shift'] });
    await code.getByRole('button', { name: 'Add to plan' }).click();

    const dialog = page.getByRole('heading', { name: 'Add to plan' }).locator('xpath=ancestor::div[contains(@class,"max-w-lg")]');
    await dialog.locator('select').selectOption(plan.uid);
    // The V2 Action is listed. Under V1 this list was empty.
    await dialog.getByRole('button', { name: /Tighten validation/ }).click();
    await dialog.getByPlaceholder('What should change here?').fill('Reject empty emails');
    await dialog.getByRole('button', { name: 'Add reference' }).click();
    await expect(page.getByRole('heading', { name: 'Add to plan' })).toHaveCount(0);

    const full = await api('GET', `/items/${action.uid}`);
    const spec = full.fileSpecs.find((s: any) => s.path === FILE);
    expect(spec.edits[0].lineRange).toEqual({ start: 5, end: 7 });
    expect(spec.edits[0].instruction).toContain('Reject empty emails');

    // A new Action, from line 9.
    await code.locator('[data-line="9"]').click();
    await code.getByRole('button', { name: 'Add to plan' }).click();
    await dialog.locator('select').selectOption(plan.uid);
    await dialog.getByRole('button', { name: 'New action' }).click();
    await dialog.getByPlaceholder(/Refactor/).fill('Validate orders too');
    await dialog.getByRole('button', { name: 'Add reference' }).click();
    await expect(page.getByRole('heading', { name: 'Add to plan' })).toHaveCount(0);

    const items = await api('GET', `/plans/${plan.uid}/items`);
    const created = items.find((i: any) => i.title === 'Validate orders too');
    expect(created, 'the new Action is a V2 item in the plan').toBeTruthy();
    const createdFull = await api('GET', `/items/${created.uid}`);
    expect(createdFull.fileSpecs[0]).toMatchObject({ path: FILE, edits: [{ lineRange: { start: 9, end: 9 } }] });
  });
});
