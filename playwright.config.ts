import crypto from 'node:crypto';
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
/**
 * The suite's OWN data directory and token.
 *
 * The backend below used to run with no CODETRELLIS_DATA_DIR, so it
 * wrote into the developer's real ~/.codetrellis: every test's project,
 * plan and settings change landed in the database the desktop app uses.
 * A throwaway directory per run keeps the suite off real data.
 *
 * The token is pinned rather than read from the directory: a fresh
 * directory has no token file until the backend boots, and this config
 * is evaluated before that. The backend honours CODETRELLIS_CAPABILITY_TOKEN
 * (see capability-token.ts) and writes it to the directory, where the Vite
 * proxy and `e2e/helpers` read it. Set on process.env so worker processes,
 * which inherit the runner's environment, agree with the runner.
 */
process.env.CODETRELLIS_DATA_DIR ??= path.join(os.tmpdir(), `codetrellis-e2e-${process.pid}`);
process.env.CODETRELLIS_CAPABILITY_TOKEN ??= crypto.randomBytes(24).toString('hex');
const E2E_DATA_DIR = process.env.CODETRELLIS_DATA_DIR;
const E2E_TOKEN = process.env.CODETRELLIS_CAPABILITY_TOKEN;

function capabilityToken(): Record<string, string> {
  return { 'x-codetrellis-token': E2E_TOKEN };
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

const MARKETING_IGNORE = process.env.E2E_MARKETING ? [] : ['**/marketing/**'];

/**
 * Named spec files on the command line. A full run orders the ui-driving
 * project after everything else; a targeted one just runs what was named.
 */
const TARGETED = process.argv.some((a) => /\.(spec|setup)\.ts(:\d+)*$/.test(a) || /(^|\/)e2e\/[^-]/.test(a));

/** Specs whose agents navigate every open page — see the `ui-driving` project. */
const UI_DRIVING_SPECS = [
  '**/live-agent/preseeded-execution.spec.ts',
  '**/live-agent/preseeded-deviation.spec.ts',
  '**/live-agent/authored-deviation.spec.ts',
  '**/live-agent/agent-authored-flow.spec.ts',
  '**/golden-chain/mcp-agent-flow.spec.ts',
  '**/mcp-tools/changes-drift-templates.spec.ts',
];

export default defineConfig({
  testDir: './e2e',
  // The marketing spec regenerates committed screenshots under
  // marketing-assets/. In a normal run it silently rewrote them with
  // whatever test data was loaded. Opt in with E2E_MARKETING=1.
  testIgnore: MARKETING_IGNORE,
  timeout: 30000,
  // Playwright's default is half the CPU cores. Every test opens and scans
  // this whole repository in its own Chromium against ONE backend, so on a
  // laptop the default drove swap to 6.5 of 8 GB and filled the disk.
  // Two is what a developer machine carries; CI or a big box can raise it.
  workers: Number(process.env.E2E_WORKERS) || 2,
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
      env: { CODETRELLIS_DATA_DIR: E2E_DATA_DIR, CODETRELLIS_CAPABILITY_TOKEN: E2E_TOKEN },
      // Reusing whatever is on :3001 meant testing against the developer's
      // dev backend and its real data, with a token this run does not
      // hold. A busy port now fails loudly; opt back in explicitly.
      reuseExistingServer: Boolean(process.env.E2E_REUSE_SERVER),
      timeout: 15000,
    },
    {
      command: 'npx vite --config vite.web.config.ts',
      port: 5173,
      env: { CODETRELLIS_DATA_DIR: E2E_DATA_DIR },
      reuseExistingServer: Boolean(process.env.E2E_REUSE_SERVER),
      timeout: 15000,
    },
  ],
  projects: [
    // Opens the project under test once — see e2e/project.setup.ts.
    // Its `teardown` is the ui-driving project below: Playwright runs a
    // teardown after every project that depends on setup has finished, and
    // runs it even when some of their tests failed. As an ordinary dependent
    // of `chromium` it would be skipped outright by one failing UI spec.
    //
    // Not on a targeted run (`npx playwright test e2e/plan/x.spec.ts`): a
    // teardown ignores the file filter, so every targeted run also ran all
    // 39 agent specs, while running one of THOSE files alone skipped setup.
    // Targeted, ui-driving depends on setup like everything else.
    { name: 'setup', testMatch: /project\.setup\.ts$/, ...(TARGETED ? {} : { teardown: 'ui-driving' }) },
    {
      name: 'chromium',
      use: { browserName: 'chromium' },
      dependencies: ['setup'],
      // A project's testIgnore REPLACES the top-level one, so repeat it.
      testIgnore: [...MARKETING_IGNORE, ...UI_DRIVING_SPECS],
    },
    // After every other spec, one at a time. These call MCP tools that steer
    // the UI (`set_active_plan`, `open_plan`, `navigate_to`), which broadcast
    // `ui-navigate` to EVERY connected page — by design, so the app follows
    // the agent. Run beside the UI specs, they switched another worker's page
    // to their plan mid-test: the canvas dropped the selected item, and the
    // Plans tab sat under a workspace nobody in that test had opened.
    {
      name: 'ui-driving',
      use: { browserName: 'chromium' },
      testMatch: UI_DRIVING_SPECS,
      ...(TARGETED ? { dependencies: ['setup'] } : {}),
      workers: 1,
    },
  ],
});
