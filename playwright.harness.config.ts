/**
 * Playwright config for the E2E harness suite.
 *
 * Different from the existing `playwright.config.ts` in two ways:
 *
 *   1. **No webServer block.** The harness spawns its own backend
 *      child-process per test (with isolated data dir + ports), so
 *      we don't want Playwright to launch a shared one.
 *
 *   2. **Test dir is `tests/e2e/`** (not `e2e/`). The legacy suite
 *      under `e2e/` still hits the developer's running backend on
 *      `:3001` / `:5173`; the harness suite under `tests/e2e/` is
 *      hermetic. They can coexist; eventually the legacy suite
 *      should be migrated or deleted.
 */

import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './tests/e2e',
  testMatch: /.*\.test\.ts$/,
  // Generous default — harness tests boot a real backend per test.
  // Individual tests can override with `test.setTimeout(...)`.
  timeout: 90_000,
  // Each test owns its backend; running them in parallel inside the
  // same worker is fine, but inside the *same* worker process Node
  // can struggle with many concurrent tsx subprocesses on slower
  // machines. Default to 1 worker; override with --workers.
  workers: 1,
  // Each harness test boots a real backend subprocess + chokidar +
  // tsx + sql.js + tree-sitter — there's a lot going on per test,
  // and under heavy local load (parallel agent runs, fs churn from
  // previous tests' tmp-dir cleanup) the timing-sensitive tests
  // (file-watcher → auto-advance, chokidar → plan-import) can
  // exceed their per-step timeouts. Two retries treats those
  // genuine flakes as transient — green on the second or third
  // attempt. Keeps the suite signal-to-noise high.
  retries: 2,
  reporter: process.env.CI ? [['list'], ['github']] : 'list',
  use: {
    // Tests that don't use the browser ignore this — set so the
    // shared types compile.
    baseURL: 'http://127.0.0.1',
    trace: 'on-first-retry',
  },
  // No webServer — the harness manages its own backends.
  projects: [
    {
      name: 'harness',
      use: { browserName: 'chromium' },
    },
  ],
});
