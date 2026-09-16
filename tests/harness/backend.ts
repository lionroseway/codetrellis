/**
 * Boots the CodeTrellis backend as a child process for the harness.
 *
 * Why a child process and not in-process import: the backend has
 * module-level state (singletons for the server, MCP transport, file
 * watcher, auto-save timer). Importing it twice in one process gives
 * us the same instance, which makes per-test isolation a nightmare.
 * A subprocess gets a fresh module graph + a clean SIGTERM-ready
 * lifecycle for cheap.
 *
 * Each spawned backend gets its own:
 *   - data dir            (`CODETRELLIS_DATA_DIR`)
 *   - REST port           (`CODETRELLIS_BACKEND_PORT`)
 *   - MCP SSE port        (`CODETRELLIS_MCP_PORT`)
 *
 * All three env vars already exist in the backend (see
 * `services/persistence.ts` + `server.ts` + `mcp/server.ts`).
 */

import { randomBytes } from 'node:crypto';
import { spawn, ChildProcess } from 'node:child_process';
import path from 'node:path';
import { REPO_ROOT } from './paths';
import { findFreePorts } from './ports';

export interface RunningBackend {
  /** Port for HTTP REST API + WebSocket. */
  backendPort: number;
  /** Port for MCP SSE server. */
  mcpPort: number;
  /** Base URL for REST calls — `http://127.0.0.1:<backendPort>`. */
  baseUrl: string;
  /** Capability token this backend requires on every request (Gate 1.1). */
  capabilityToken: string;
  /** Stop the backend cleanly. Idempotent — safe to call twice. */
  stop(): Promise<void>;
}

export interface StartBackendOptions {
  /** Data dir override. Required — usually `<tmp>/data`. */
  dataDir: string;
  /**
   * If true, pipe child stdout/stderr to the parent. Defaults to
   * **false** (silent) so test output stays clean. Flip to true when
   * a test fails and you need to see what the backend logged.
   */
  verbose?: boolean;
  /** Override the REST port. Default: a free port chosen by the kernel. */
  backendPort?: number;
  /** Override the MCP port. Default: a free port chosen by the kernel. */
  mcpPort?: number;
  /** Wait timeout for `/api/build-info` to return 200. Default: 30s. */
  readyTimeoutMs?: number;
}

/**
 * Start the backend, wait for it to answer `/api/build-info`, return
 * the controller. Errors fast on a bad start so tests don't hang.
 */
export async function startBackend(opts: StartBackendOptions): Promise<RunningBackend> {
  const [backendPort, mcpPort] = await Promise.all([
    opts.backendPort ? Promise.resolve(opts.backendPort) : pickPort(),
    opts.mcpPort ? Promise.resolve(opts.mcpPort) : pickPort(),
  ]);

  // Unique per spawned backend — see CODETRELLIS_CAPABILITY_TOKEN below.
  const capabilityToken = randomBytes(24).toString('hex');

  const env = {
    ...process.env,
    CODETRELLIS_DATA_DIR: opts.dataDir,
    CODETRELLIS_BACKEND_PORT: String(backendPort),
    CODETRELLIS_MCP_PORT: String(mcpPort),
    // Every local transport requires a capability token (Phase 19 Gate 1.1).
    // Pinning it here rather than reading the file the backend writes avoids
    // racing the write during boot, and keeps each harness backend's token
    // distinct so a leaked one cannot reach another test's instance.
    CODETRELLIS_CAPABILITY_TOKEN: capabilityToken,
    PORT: String(backendPort),
    NODE_ENV: 'test',
  };

  const child = spawn(
    'npx',
    ['tsx', path.join(REPO_ROOT, 'src', 'backend', 'index.ts')],
    {
      cwd: REPO_ROOT,
      env,
      stdio: opts.verbose ? 'inherit' : ['ignore', 'pipe', 'pipe'],
    },
  );

  // Buffer recent stderr so we can show it on a startup failure.
  const stderrTail: string[] = [];
  if (!opts.verbose && child.stderr) {
    child.stderr.on('data', (chunk: Buffer) => {
      stderrTail.push(chunk.toString());
      // Keep ~32 KB of recent stderr — enough to diagnose, not so much
      // we OOM on an infinite-loop crash.
      while (stderrTail.join('').length > 32768) stderrTail.shift();
    });
  }

  // Watch for early exit during boot.
  let earlyExit: { code: number | null; signal: NodeJS.Signals | null } | null = null;
  child.once('exit', (code, signal) => {
    earlyExit = { code, signal };
  });

  const baseUrl = `http://127.0.0.1:${backendPort}`;
  const ready = await waitForReady(baseUrl, opts.readyTimeoutMs ?? 30000, () => earlyExit);
  if (!ready.ok) {
    await killChild(child);
    const tail = stderrTail.join('').slice(-2000);
    throw new Error(
      `Backend failed to come up: ${ready.reason}\n` +
        (tail ? `--- last stderr ---\n${tail}` : ''),
    );
  }

  let stopped = false;
  const stop = async () => {
    if (stopped) return;
    stopped = true;
    await killChild(child);
  };

  return { backendPort, mcpPort, baseUrl, capabilityToken, stop };
}

async function pickPort(): Promise<number> {
  const [p] = await findFreePorts(1);
  return p;
}

async function waitForReady(
  baseUrl: string,
  timeoutMs: number,
  earlyExit: () => { code: number | null; signal: NodeJS.Signals | null } | null,
): Promise<{ ok: true } | { ok: false; reason: string }> {
  const deadline = Date.now() + timeoutMs;
  // /api/health is the ONLY unauthenticated path (see local-auth.ts).
  // build-info used to serve here, but it now requires the capability token,
  // and polling it would 401 until timeout rather than detecting readiness.
  const url = `${baseUrl}/api/health`;
  while (Date.now() < deadline) {
    const exit = earlyExit();
    if (exit) {
      return { ok: false, reason: `child exited (code=${exit.code}, signal=${exit.signal}) during boot` };
    }
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(1000) });
      if (res.ok) return { ok: true };
    } catch {
      // not up yet
    }
    await sleep(150);
  }
  return { ok: false, reason: `timeout after ${timeoutMs}ms waiting for ${url}` };
}

async function killChild(child: ChildProcess): Promise<void> {
  if (child.exitCode !== null || child.signalCode !== null) return;
  return new Promise((resolve) => {
    const killTimer = setTimeout(() => {
      try {
        child.kill('SIGKILL');
      } catch {
        /* already dead */
      }
    }, 5000);
    child.once('exit', () => {
      clearTimeout(killTimer);
      resolve();
    });
    try {
      child.kill('SIGTERM');
    } catch {
      clearTimeout(killTimer);
      resolve();
    }
  });
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
