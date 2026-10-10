/**
 * Terminal presets — + button dropdown, 4 presets.
 *
 * Covers: new terminal button, preset creation via API,
 * preset names (claude, codex, aider, shell).
 */

import { test, expect, type APIResponse } from '@playwright/test';
import { gotoWithProject, API } from '../helpers/setup';

test.describe('Terminal presets', () => {
  // Only the sessions this file started: terminals are the whole backend's,
  // and deleting every one killed a parallel spec's shell under it (#387).
  const mine: string[] = [];
  const started = async (res: APIResponse) => {
    const session = await res.json();
    if (session?.id) mine.push(session.id);
    return session;
  };
  test.afterEach(async ({ request }) => {
    for (const id of mine.splice(0)) await request.delete(`${API}/terminals/${id}`);
  });

  test('New terminal button is visible in the panel', async ({ page }) => {
    // Opening the panel with no sessions starts a shell: that one is ours too.
    page.on('response', (r) => {
      if (r.request().method() === 'POST' && new URL(r.url()).pathname === '/api/terminals' && r.ok()) void started(r);
    });
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
    const session = await started(res);
    expect(session.preset).toBe('shell');
  });

  test('claude preset creates a session via API', async ({ request }) => {
    const res = await request.post(`${API}/terminals`, {
      data: { preset: 'claude', cwd: process.cwd(), title: 'Preset Claude' },
    });
    expect(res.ok()).toBeTruthy();
    const session = await started(res);
    expect(session.preset).toBe('claude');
  });

  test('codex preset creates a session via API', async ({ request }) => {
    const res = await request.post(`${API}/terminals`, {
      data: { preset: 'codex', cwd: process.cwd(), title: 'Preset Codex' },
    });
    expect(res.ok()).toBeTruthy();
    const session = await started(res);
    expect(session.preset).toBe('codex');
  });

  test('aider preset creates a session via API', async ({ request }) => {
    const res = await request.post(`${API}/terminals`, {
      data: { preset: 'aider', cwd: process.cwd(), title: 'Preset Aider' },
    });
    expect(res.ok()).toBeTruthy();
    const session = await started(res);
    expect(session.preset).toBe('aider');
  });
});
