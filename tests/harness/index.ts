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
export { authFetch } from './client';
export {
  createMcpClient,
  type ScriptedMcp,
  type McpClientOptions,
  type McpToolResult,
} from './mcp-client';
export {
  createScriptedAgent,
  type ScriptedAgent,
  type ScriptedAgentOptions,
} from './scripted-agent';

import { prepareFixture, PreparedFixture } from './fixture';
import { startBackend, RunningBackend } from './backend';
import { createClient, RestClient } from './client';
import { createScriptedAgent, ScriptedAgent } from './scripted-agent';

export interface Harness {
  fixture: PreparedFixture;
  backend: RunningBackend;
  client: RestClient;
  /**
   * Spin up a connected scripted agent against the harness's MCP
   * server. The agent registers a session immediately. Multiple
   * agents may be spawned per harness instance — each gets its own
   * MCP transport / sessionId, suitable for contention tests.
   * Disconnects automatically on `teardown()`.
   */
  spawnAgent(opts?: { agentType?: string; model?: string }): Promise<ScriptedAgent>;
  /** Stop the backend + delete the tmp dir + disconnect agents. Idempotent. */
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

  const client = createClient(backend.baseUrl, backend.capabilityToken);
  const agents: ScriptedAgent[] = [];

  const spawnAgent = async (
    agentOpts: { agentType?: string; model?: string } = {},
  ): Promise<ScriptedAgent> => {
    const agent = createScriptedAgent({
      mcpPort: backend!.mcpPort,
      agentType: agentOpts.agentType ?? `harness-agent-${agents.length + 1}`,
      model: agentOpts.model,
      projectPath: fixture.projectPath,
    });
    await agent.connect();
    agents.push(agent);
    return agent;
  };

  let torn = false;
  const teardown = async () => {
    if (torn) return;
    torn = true;
    // Disconnect every spawned agent first so the backend doesn't
    // see SSE drops mid-shutdown — order matters less for
    // correctness than for clean stderr in CI.
    await Promise.allSettled(agents.map((a) => a.disconnect()));
    try {
      await backend!.stop();
    } finally {
      fixture.cleanup();
    }
  };

  return { fixture, backend, client, spawnAgent, teardown };
}
