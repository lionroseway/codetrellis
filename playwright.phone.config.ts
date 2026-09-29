/**
 * The phone's screens, rendered and photographed (Phase 32 A4.5a).
 *
 * `npm run test:phone`. Serves tools/phone-preview (the real screens from
 * mobile/, through react-native-web, with native modules stubbed and RPC
 * answered from fixtures) and runs tests/phone/ against it. Screenshots land
 * in test-results/phone/.
 */
import { defineConfig, devices } from '@playwright/test';

const PORT = Number(process.env.PHONE_PREVIEW_PORT ?? 5190);

export default defineConfig({
  testDir: 'tests/phone',
  timeout: 30_000,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [['list'], ['html', { open: 'never', outputFolder: 'playwright-report/phone' }]] : 'list',
  use: {
    ...devices['Desktop Chrome'],
    baseURL: `http://localhost:${PORT}`,
    viewport: { width: 390, height: 844 },
    deviceScaleFactor: 2,
  },
  webServer: {
    command: `npx vite --config tools/phone-preview/vite.config.ts --port ${PORT} --strictPort`,
    url: `http://localhost:${PORT}/`,
    reuseExistingServer: !process.env.CI,
    timeout: 60_000,
  },
});
