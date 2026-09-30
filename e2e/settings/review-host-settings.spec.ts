/**
 * Settings → Review hosts, from the window (Phase 32 C2.2a).
 *
 * Sam opens Settings → Review hosts. Before anything is sent it names the
 * project's host and what it would read, says it is off, and says where a
 * token would be kept. He turns GitHub on and saves a token: the field
 * clears, "Token saved" replaces it, and the token is not shown again.
 *
 * The answers are served (the backend's side, with the grant rule and the
 * stand-in host that is asked nothing, is tests/e2e/review-host-switch.test.ts),
 * so the screen is tested whatever this checkout's remote is.
 */

import fs from 'node:fs';
import path from 'node:path';
import { test, expect, type Page } from '@playwright/test';
import { gotoWithProject } from '../helpers/setup';

const OUT = path.join('test-results', 'ux-audit');
const TOKEN = 'github_pat_11ABCDEFG0123456789_secretpart';

const detected = {
  kind: 'github', hostname: 'github.com', owner: 'acme', repo: 'app', slug: 'acme/app', webUrl: 'https://github.com/acme/app', supported: true,
  asks: "Reads the pull requests for this project's branches on github.com/acme/app: whether each is open, merged or closed, its checks and its reviews. It changes nothing on GitHub.",
};
const where = 'encrypted with a key held by the macOS Keychain';
const state = (enabled: boolean, saved: boolean) => ({
  project: '/work/acme', detected, enabled, turnedOnFor: null,
  changedAt: enabled ? Date.now() : null, changedBy: enabled ? 'sam' : null,
  token: { saved, kind: 'os-keychain', where },
  says: !enabled ? 'Off. Nothing is sent to GitHub; state comes from git.'
    : saved ? 'On: reads github.com/acme/app with your token.' : 'On: reads github.com/acme/app without a token, which works for a public repository only.',
});

async function serve(page: Page) {
  let enabled = false;
  let saved = false;
  const sent: Array<{ method: string; body: unknown }> = [];
  await page.route('**/api/review-host/token?*', async (route) => {
    const method = route.request().method();
    sent.push({ method, body: route.request().postDataJSON?.() ?? null });
    saved = method === 'PUT';
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(state(enabled, saved)) });
  });
  await page.route('**/api/review-host?*', async (route) => {
    const method = route.request().method();
    if (method === 'PUT') {
      const body = route.request().postDataJSON() as { enabled: boolean };
      sent.push({ method, body });
      enabled = body.enabled;
    }
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(state(enabled, saved)) });
  });
  return sent;
}

test('Review hosts: says what would be read and where a token is kept; turned on, a token saved and not shown again', async ({ page }) => {
  const sent = await serve(page);
  await gotoWithProject(page);
  await page.locator('button[title*="Settings"]').click();
  const dialog = page.getByRole('dialog', { name: 'Settings' });
  await dialog.getByRole('button', { name: 'Review hosts', exact: true }).click();

  const section = dialog.getByTestId('review-host-section');
  await expect(section.getByTestId('review-host-remote')).toHaveText('Its remote: github.com/acme/app (GitHub)');
  await expect(section.getByTestId('review-host-asks')).toHaveText(detected.asks);
  await expect(section.getByTestId('review-host-says')).toHaveText('Off. Nothing is sent to GitHub; state comes from git.');
  await expect(section.getByTestId('review-host-token-where')).toHaveText(`Where it is kept: ${where}.`);
  const toggle = section.getByTestId('review-host-toggle');
  await expect(toggle).toHaveText('Turn on GitHub');
  await expect(toggle).toHaveAttribute('aria-pressed', 'false');

  await toggle.click();
  await expect(section.getByTestId('review-host-says')).toHaveText('On: reads github.com/acme/app without a token, which works for a public repository only.');
  await expect(toggle).toHaveText('Turn off');

  await section.getByTestId('review-host-token').fill(TOKEN);
  await section.getByRole('button', { name: 'Save' }).click();
  await expect(section.getByTestId('review-host-token-saved')).toHaveText('Token saved');
  await expect(section.getByTestId('review-host-says')).toHaveText('On: reads github.com/acme/app with your token.');
  await expect(section.getByTestId('review-host-token')).toHaveCount(0);
  expect(await dialog.textContent()).not.toContain(TOKEN);
  fs.mkdirSync(OUT, { recursive: true });
  await dialog.screenshot({ path: path.join(OUT, 'review-host-settings.png') });

  expect(sent).toEqual([
    { method: 'PUT', body: { enabled: true } },
    { method: 'PUT', body: { token: TOKEN } },
  ]);

  // Forgotten: the field is back.
  await section.getByTestId('review-host-token-forget').click();
  await expect(section.getByTestId('review-host-token')).toBeVisible();
});
