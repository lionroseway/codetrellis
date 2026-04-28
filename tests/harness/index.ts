/**
 * E2E harness — public API.
 *
 * Typical use:
 *
 * ```ts
 * import { test, expect } from '@playwright/test';
 * import { setupHarness } from '../harness';
 *
 * test('smoke', async () => {
 *   const h = await setupHarness('smoke');
 *   try {
 *     const scan = await h.client.scanProject(h.fixture.projectPath);
 *     expect(scan.fileCount).toBeGreaterThan(20);
 *   } finally {
 *     await h.teardown();
 *   }
 * });
 * ```
 *
 * The harness composes three independent pieces:
 *   - **fixture** — a tmp clone of `tests/fixtures/sample-app/` with
 *     its own `git init`'d HEAD.
 *   - **backend** — a child process running the real backend, with
 *     its own data dir + ports.
 *   - **client** — a typed REST helper bound to the spawned backend's
 *     base URL.
 *
 * Each test calls `setupHarness(name)` in the body (NOT `beforeEach`)
 * so the cleanup function can be wrapped in try/finally — Playwright
 * doesn't have a great story for "always run teardown even if setup
 * threw."
 */

export { prepareFixture, type PreparedFixture } from './fixture';
export { startBackend, type RunningBackend, type StartBackendOptions } from './backend';
export {
  createClient,
  type RestClient,
  type ScanResult,
  type DbStats,
  type PlanSummary,
  type PlanDetail,
  type CreatePlanInput,
  type BuildInfo,
} from './client';
export { findFreePort, findFreePorts } from './ports';
export {
  REPO_ROOT,
  FIXTURE_TEMPLATE,
  TMP_ROOT,
  tmpDirFor,
  slugify,
} from './paths';
export { waitFor, sleep, type WaitForOptions } from './wait';

import { prepareFixture, PreparedFixture } from './fixture';
import { startBackend, RunningBackend } from './backend';
import { createClient, RestClient } from './client';

export interface Harness {
  fixture: PreparedFixture;
  backend: RunningBackend;
  client: RestClient;
  /** Stop the backend + delete the tmp dir. Idempotent. */
  teardown(): Promise<void>;
}

export interface SetupHarnessOptions {
  /** Pipe backend stdout/stderr to the parent. Default: false. */
  verbose?: boolean;
  /** Override the backend ready timeout. Default: 30s. */
  readyTimeoutMs?: number;
}

/**
 * One-call setup: prepares the fixture, boots the backend pointed at
 * a fresh data dir, returns everything wired together.
 *
 * Call `teardown()` in a `finally` block — it tears down the backend
 * and deletes the tmp dir.
 */
export async function setupHarness(
  testName: string,
  opts: SetupHarnessOptions = {},
): Promise<Harness> {
  const fixture = prepareFixture(testName);

  let backend: RunningBackend | null = null;
  try {
    backend = await startBackend({
      dataDir: fixture.dataDir,
      verbose: opts.verbose,
      readyTimeoutMs: opts.readyTimeoutMs,
    });
  } catch (err) {
    // Backend failed to come up — cleanup the fixture so we don't
    // leave tmp dirs lying around.
    fixture.cleanup();
    throw err;
  }

  const client = createClient(backend.baseUrl);

  let torn = false;
  const teardown = async () => {
    if (torn) return;
    torn = true;
    try {
      await backend!.stop();
    } finally {
      fixture.cleanup();
    }
  };

  return { fixture, backend, client, teardown };
}
