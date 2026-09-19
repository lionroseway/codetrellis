import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { defineConfig } from '@playwright/test';

/**
 * The capability token, attached to every request this suite makes.
 *
 * Phase 19's first rule is that loopback is not an authorisation
 * boundary, so `/api/*` authenticates. This suite predates that and was
 * never updated: every spec that talks to the API through Playwright's
 * request context got a 401, and 320 of 638 tests failed for that one
 * reason. It went unnoticed because the suite is not in CI.
 *
 * Setting it here rather than in each spec means a spec cannot forget,
 * and an endpoint that starts authenticating later does not break the
 * suite a second time. In-page `fetch('/api/…')` needs nothing: it goes
 * through the Vite proxy, which attaches the token itself.
 *
 * Read once at config load. The token is minted per backend launch, so a
 * backend that restarts mid-run invalidates it — that presents as a
 * sudden wall of 401s, and the fix is to re-run, not to debug the app.
 */
function capabilityToken(): Record<string, string> {
  const dataDir = process.env.CODETRELLIS_DATA_DIR ?? path.join(os.homedir(), '.codetrellis');
  try {
    return {
      'x-codetrellis-token': fs.readFileSync(path.join(dataDir, 'capability-token'), 'utf-8').trim(),
    };
  } catch {
    // No token yet — the webServer below mints one on boot. Going out
    // unauthenticated makes the failure read as 401 rather than ENOENT,
    // which is the more useful thing to find in a report.
    return {};
  }
}

/**
 * Pre-seed localStorage so the "Learn CodeTrellis" onboarding dialog
 * and the "Getting Started" checklist don't pop up and block clicks.
 * Tests that explicitly test onboarding should clear these flags.
 */
const PROJECT_PATH = process.cwd();
const storageState = {
  cookies: [],
  origins: [
    {
      origin: 'http://localhost:5173',
      localStorage: [
        { name: 'codetrellis:guide:seen', value: '1' },
        { name: 'codetrellis:learn-trellis:seen', value: '1' },
        { name: `codetrellis:gettingStarted:dismissed:${PROJECT_PATH}`, value: '1' },
      ],
    },
  ],
};

export default defineConfig({
  testDir: './e2e',
  timeout: 30000,
  retries: 0,
  use: {
    baseURL: 'http://localhost:5173',
    headless: true,
    screenshot: 'only-on-failure',
    trace: 'on-first-retry',
    storageState,
    extraHTTPHeaders: capabilityToken(),
  },
  webServer: [
    {
      command: 'npx tsx src/backend/index.ts',
      port: 3001,
      reuseExistingServer: true,
      timeout: 15000,
    },
    {
      command: 'npx vite --config vite.web.config.ts',
      port: 5173,
      reuseExistingServer: true,
      timeout: 15000,
    },
  ],
  projects: [
    {
      name: 'chromium',
      use: { browserName: 'chromium' },
    },
  ],
});
