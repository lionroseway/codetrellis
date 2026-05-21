/**
 * Playwright config for marketing asset capture.
 *
 * Two projects:
 *   - `screenshots` — 4K retina (1920×1080 @ 2× = 3840×2160 PNGs)
 *   - `videos`      — native 1080p (1920×1080 @ 1× = no downscale artifacts)
 *
 * Usage:
 *   npm run capture                       # all screenshots + videos
 *   npm run capture:screenshots           # screenshots only
 *   npm run capture:videos                # videos only
 *   npx playwright test --config=playwright.marketing.config.ts -g "hero"
 */
import { defineConfig } from '@playwright/test';

const PROJECT_PATH = process.cwd();

const storageState = {
  cookies: [],
  origins: [
    {
      origin: 'http://localhost:5173',
      localStorage: [
        { name: 'codetrellis:learn-trellis:seen', value: '1' },
        { name: `codetrellis:gettingStarted:dismissed:${PROJECT_PATH}`, value: '1' },
      ],
    },
  ],
};

const webServers = [
  {
    command: 'npx tsx src/backend/index.ts',
    port: 3001,
    reuseExistingServer: true,
    timeout: 30_000,
  },
  {
    command: 'npx vite --config vite.web.config.ts',
    port: 5173,
    reuseExistingServer: true,
    timeout: 30_000,
  },
];

export default defineConfig({
  testDir: './e2e/marketing',
  timeout: 180_000,
  retries: 0,
  workers: 1,
  webServer: webServers,
  outputDir: 'marketing-assets/test-results',
  use: {
    baseURL: 'http://localhost:5173',
    headless: true,
    storageState,
    actionTimeout: 10_000,
    // Force CPU compositing so xterm.js canvas renders in headless mode
    launchOptions: {
      args: ['--disable-gpu', '--disable-gpu-compositing'],
    },
  },
  projects: [
    {
      name: 'screenshots',
      testMatch: /screenshots\.spec\.ts/,
      use: {
        browserName: 'chromium',
        // Headed mode: xterm.js canvas renders for terminal screenshots
        headless: false,
        // Retina: 1920×1080 layout → 3840×2160 pixel output
        viewport: { width: 1920, height: 1080 },
        deviceScaleFactor: 2,
        video: 'off',
      },
    },
    {
      name: 'videos',
      testMatch: /videos\.spec\.ts/,
      use: {
        browserName: 'chromium',
        // Headed mode: xterm.js canvas renders correctly (headless skips canvas)
        headless: false,
        // Native 1080p: render size = video size, no downscale artifacts
        viewport: { width: 1920, height: 1080 },
        deviceScaleFactor: 1,
        video: {
          mode: 'on',
          size: { width: 1920, height: 1080 },
        },
      },
    },
  ],
});
