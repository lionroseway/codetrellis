/**
 * An agent asks to delete a plan; only the person's typed confirmation
 * deletes it (Phase 32 §0.4c-3).
 *
 * Serial (playwright.config SERIAL_SPECS): the request reaches every open
 * page.
 */

import { test, expect } from '@playwright/test';
import { API, authHeaders, gotoWithProject, PROJECT_PATH } from '../helpers/setup';
import { createMcpClient } from '../helpers/mcp-client';

async function api(method: string, url: string, body?: unknown): Promise<any> {
  const res = await fetch(`${API}${url}`, {
    method,
    headers: { 'Content-Type': 'application/json', ...authHeaders() },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`${method} ${url}: ${res.status} ${await res.text()}`);
  return res.json();
}

test.describe('Plan deletion requested by an agent', () => {
  test('Delete stays disabled until the plan name is typed, then deletes it', async ({ page }) => {
    const title = `e2e-deletion-${Date.now()}`;
    const plan = await api('POST', '/plans', { title, projectPath: PROJECT_PATH });
    await gotoWithProject(page);

    const client = await createMcpClient();
    try {
      await client.callTool('request_plan_deletion', { plan_uids: [plan.uid], reason: 'Superseded by the new rollout plan.' });
    } finally {
      client.close();
    }

    const dialog = page.getByTestId('plan-deletion-request');
    await expect(dialog).toBeVisible({ timeout: 5000 });
    await expect(dialog.getByRole('heading')).toHaveText(/asked to delete a plan/);
    await expect(dialog).toContainText('Superseded by the new rollout plan.');
    await expect(dialog).toContainText(title);

    const del = dialog.getByRole('button', { name: 'Delete' });
    await expect(del).toBeDisabled();
    const input = dialog.getByLabel(/to delete/);
    await input.fill('delete it');
    await expect(del).toBeDisabled();
    // Still there while unconfirmed.
    expect((await api('GET', `/plans/${plan.uid}`)).status).not.toBe('archived');

    await input.fill(title);
    await expect(del).toBeEnabled();
    await page.screenshot({ path: test.info().outputPath('plan-deletion-request.png') });
    await del.click();
    await expect(dialog).toHaveCount(0);
    await expect.poll(async () => (await api('GET', `/plans/${plan.uid}`)).status).toBe('archived');
  });

  test('keeping the plan leaves it untouched', async ({ page }) => {
    const title = `e2e-deletion-keep-${Date.now()}`;
    const plan = await api('POST', '/plans', { title, projectPath: PROJECT_PATH });
    await gotoWithProject(page);

    const client = await createMcpClient();
    try {
      await client.callTool('request_plan_deletion', { plan_uids: [plan.uid], reason: 'Looks stale.' });
    } finally {
      client.close();
    }
    const dialog = page.getByTestId('plan-deletion-request');
    await expect(dialog).toBeVisible({ timeout: 5000 });
    await dialog.getByRole('button', { name: 'Keep it' }).click();
    await expect(dialog).toHaveCount(0);
    expect((await api('GET', `/plans/${plan.uid}`)).status).not.toBe('archived');
    await api('DELETE', `/plans/${plan.uid}`);
  });
});
