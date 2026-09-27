/**
 * Every settings section that saves, saves (Phase 32 §0.4k).
 *
 * The other specs here mostly check that a section renders. This changes one
 * control in each section that writes settings, reads the settings back from
 * the API, and puts it back. And a value the backend refuses says so in the
 * modal, instead of the control silently not taking.
 */

import { test, expect, type Page, type APIRequestContext } from '@playwright/test';
import { gotoWithProject, API, authHeaders } from '../helpers/setup';

const settingsNow = async (request: APIRequestContext) =>
  (await request.get(`${API}/settings`, { headers: authHeaders() })).json();

async function openSection(page: Page, name: string) {
  await gotoWithProject(page);
  await page.locator('button[title*="Settings"]').click();
  await page.getByRole('dialog').getByRole('button', { name, exact: true }).click();
}

test.describe('Settings sections save', () => {
  let before: Record<string, any>;
  test.beforeEach(async ({ request }) => { before = await settingsNow(request); });
  test.afterEach(async ({ request }) => {
    const { identity, mcp, plans, device, power } = before;
    await request.put(`${API}/settings`, { headers: authHeaders(), data: { identity, mcp: { port: mcp.port, autodetectOnCollision: mcp.autodetectOnCollision }, plans, device, power } });
  });

  test('Identity: the display name, on leaving the box', async ({ page, request }) => {
    await openSection(page, 'Identity');
    const name = page.getByRole('dialog').locator('input').first();
    await name.fill('Dana (settings spec)');
    await name.blur();
    await expect.poll(async () => (await settingsNow(request)).identity.displayName).toBe('Dana (settings spec)');
  });

  test('MCP Server: a port that is not one is refused, and the modal says why', async ({ page, request }) => {
    await openSection(page, 'MCP Server');
    const port = page.getByRole('dialog').locator('input[type="number"]').first();
    await port.fill('80');
    await port.blur();
    await expect(page.getByTestId('settings-save-error')).toContainText('Not saved: mcp.port must be a port from 1024 to 65535');
    expect((await settingsNow(request)).mcp.port).toBe(before.mcp.port);
  });

  test('Plans: default visibility', async ({ page, request }) => {
    await openSection(page, 'Plans');
    const target = before.plans.defaultVisibility === 'local' ? 'Shared (commit to .codetrellis/)' : 'Local (DB only)';
    await page.getByRole('dialog').getByRole('button', { name: target }).click();
    await expect.poll(async () => (await settingsNow(request)).plans.defaultVisibility)
      .toBe(before.plans.defaultVisibility === 'local' ? 'shared' : 'local');
  });

  test('Devices: sharing audio capture', async ({ page, request }) => {
    await openSection(page, 'Devices');
    await page.getByRole('dialog').getByText('Share audio capture with paired devices').click();
    await expect.poll(async () => (await settingsNow(request)).device.shareAudio).toBe(!before.device.shareAudio);
  });

  test('Power: keep awake while an agent is active', async ({ page, request }) => {
    await openSection(page, 'Power');
    await page.getByRole('dialog').getByText('An MCP agent is active').click();
    await expect.poll(async () => (await settingsNow(request)).power.triggers.whileAgentActive).toBe(!before.power.triggers.whileAgentActive);
  });
});
