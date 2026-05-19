/**
 * Settings API tests — exercises user configuration and identity
 * endpoints:
 *
 *   1. GET  /api/settings              — read current settings
 *   2. PUT  /api/settings              — update settings (author info)
 *   3. GET  /api/identity/git-defaults — read git config defaults
 *
 * Uses a shared harness across all tests (serial execution) so
 * settings mutations in earlier tests are visible in later ones.
 */

import { test, expect } from '@playwright/test';
import { setupHarness, type Harness } from '../harness';

test.describe.serial('Settings API', () => {
  test.setTimeout(120_000);
  let h: Harness;

  test.beforeAll(async () => {
    h = await setupHarness('settings');
  });
  test.afterAll(async () => { await h?.teardown(); });

  test('GET /api/settings returns an object with expected keys', async () => {
    const res = await h.client.raw('GET', '/api/settings');
    expect(res.ok).toBe(true);

    const settings = await res.json();
    expect(settings).toBeTruthy();
    expect(typeof settings).toBe('object');

    // AppSettings shape: { identity, mcp, plans, data, updatedAt }
    expect(settings).toHaveProperty('mcp');
    expect(settings).toHaveProperty('identity');
    expect(settings).toHaveProperty('plans');
    expect(settings).toHaveProperty('data');
    expect(settings.mcp).toHaveProperty('port');
  });

  test('PUT /api/settings persists identity changes', async () => {
    // Update identity fields (nested under `identity`).
    const updateRes = await h.client.raw('PUT', '/api/settings', {
      identity: {
        displayName: 'Test Author',
        email: 'test@example.com',
      },
    });
    expect(updateRes.ok).toBe(true);

    const updated = await updateRes.json();
    expect(updated.identity.displayName).toBe('Test Author');
    expect(updated.identity.email).toBe('test@example.com');

    // Re-read settings and confirm the change persisted.
    const getRes = await h.client.raw('GET', '/api/settings');
    expect(getRes.ok).toBe(true);

    const reloaded = await getRes.json();
    expect(reloaded.identity.displayName).toBe('Test Author');
    expect(reloaded.identity.email).toBe('test@example.com');
  });

  test('GET /api/identity/git-defaults returns name and email', async () => {
    const res = await h.client.raw('GET', '/api/identity/git-defaults');
    expect(res.ok).toBe(true);

    const identity = await res.json();
    expect(identity).toBeTruthy();
    expect(typeof identity).toBe('object');

    // The endpoint always returns { name, email } — values may be
    // empty strings when git config is not set, but the keys must
    // exist.
    expect(identity).toHaveProperty('name');
    expect(identity).toHaveProperty('email');
    expect(typeof identity.name).toBe('string');
    expect(typeof identity.email).toBe('string');
  });
});
