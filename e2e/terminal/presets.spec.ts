/**
 * Terminal presets — + button dropdown, 4 presets.
 *
 * Covers: new terminal button, preset creation via API,
 * preset names (claude, codex, aider, shell).
 */

import { test, expect } from '@playwright/test';
import { gotoWithProject, API } from '../helpers/setup';

test.describe('Terminal presets', () => {
  test.afterEach(async ({ request }) => {
    const res = await request.get(`${API}/terminals`);
    if (res.ok()) {
      const sessions = await res.json();
      for (const s of sessions) {
        await request.delete(`${API}/terminals/${s.id}`);
      }
    }
  });

  test('New terminal button is visible in the panel', async ({ page }) => {
    await gotoWithProject(page);

    // Open terminal panel
    const termToggle = page.locator('button[title^="Toggle terminal"]');
    await termToggle.click();
    await page.waitForTimeout(1000);

    await expect(page.locator('button[title="New terminal"]')).toBeVisible({ timeout: 5000 });
  });

  test('shell preset creates a session via API', async ({ request }) => {
    const res = await request.post(`${API}/terminals`, {
      data: { preset: 'shell', cwd: process.cwd(), title: 'Preset Shell' },
    });
    expect(res.ok()).toBeTruthy();
    const session = await res.json();
    expect(session.preset).toBe('shell');
  });

  test('claude preset creates a session via API', async ({ request }) => {
    const res = await request.post(`${API}/terminals`, {
      data: { preset: 'claude', cwd: process.cwd(), title: 'Preset Claude' },
    });
    expect(res.ok()).toBeTruthy();
    const session = await res.json();
    expect(session.preset).toBe('claude');
  });

  test('codex preset creates a session via API', async ({ request }) => {
    const res = await request.post(`${API}/terminals`, {
      data: { preset: 'codex', cwd: process.cwd(), title: 'Preset Codex' },
    });
    expect(res.ok()).toBeTruthy();
    const session = await res.json();
    expect(session.preset).toBe('codex');
  });

  test('aider preset creates a session via API', async ({ request }) => {
    const res = await request.post(`${API}/terminals`, {
      data: { preset: 'aider', cwd: process.cwd(), title: 'Preset Aider' },
    });
    expect(res.ok()).toBeTruthy();
    const session = await res.json();
    expect(session.preset).toBe('aider');
  });
});
