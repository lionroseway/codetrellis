import { defineConfig } from '@playwright/test';

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
