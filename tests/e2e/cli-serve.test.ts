/**
 * Phase 32 D1.1 — `codetrellis serve` and `scan`: CodeTrellis for an agent
 * with no desktop app, as a cloud session or a CI job runs it.
 *
 * Sam's cloud session has the repository and Node, nothing else. `codetrellis
 * serve` runs the backend for it headless: on loopback only, the capability
 * token required as always, its data in the user's cache and not the
 * checkout, and nothing of its own on the network (no update check, no
 * discovery, no peers). It prints the line his agent's MCP config needs. The
 * agent launches `codetrellis mcp` in the project, which finds that backend
 * with no data dir given, and its calls are an agent's calls: it can make a
 * plan and the backend records it under the agent's name. `scan` scans once,
 * prints what it found and exits.
 */

import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import type { AddressInfo } from 'node:net';
import { spawn, execFileSync, type ChildProcess } from 'node:child_process';
import { test, expect } from '@playwright/test';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { prepareFixture, type PreparedFixture } from '../harness/fixture';
import { findFreePorts } from '../harness/ports';
import { REPO_ROOT } from '../harness/paths';
import { headlessCacheRoot } from '../../src/cli/args';

const BIN = path.join(REPO_ROOT, 'bin', 'codetrellis.mjs');

interface Served { project: string; dataDir: string; api: string; mcp: string | null; connector: { command: string; args: string[] }; counts: { files: number; symbols: number } }

/** Anything the backend might ask on its own: the update check and GitHub. */
async function trap(): Promise<{ url: string; hits: string[]; close: () => Promise<void> }> {
  const hits: string[] = [];
  const server = http.createServer((req, res) => { hits.push(req.url ?? ''); res.writeHead(503).end(); });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  return { url: `http://127.0.0.1:${(server.address() as AddressInfo).port}`, hits, close: () => new Promise((r) => server.close(() => r())) };
}

test.describe.serial('codetrellis serve', () => {
  test.setTimeout(180_000);
  let fx: PreparedFixture;
  let home: string;
  let served: Served;
  let serving: ChildProcess;
  let outbound: Awaited<ReturnType<typeof trap>>;
  let stdout = '';
  const env = () => ({
    ...(process.env as Record<string, string>),
    // A home and a cache of its own: the data dir must land in the cache.
    HOME: home, XDG_CACHE_HOME: path.join(home, '.cache'), CODETRELLIS_DATA_DIR: '',
    CODETRELLIS_CLAUDE_DIR: path.join(home, '.claude'),
    CODETRELLIS_OTA_URL: outbound.url, CODETRELLIS_GITHUB_API: outbound.url,
  });

  test.beforeAll(async () => {
    fx = prepareFixture('cli-serve');
    home = path.join(fx.tmpDir, 'home');
    fs.mkdirSync(home, { recursive: true });
    outbound = await trap();
    const [port, mcpPort] = await findFreePorts(2);
    serving = spawn(process.execPath, [BIN, 'serve', '--project', fx.projectPath, '--port', String(port), '--mcp-port', String(mcpPort), '--json'], {
      cwd: fx.projectPath, env: env(), stdio: ['ignore', 'pipe', 'pipe'], detached: process.platform !== 'win32',
    });
    serving.stdout!.on('data', (c: Buffer) => { stdout += c.toString(); });
    serving.stderr!.resume();
    await expect.poll(() => stdout.includes('\n'), { timeout: 90_000, message: 'serve prints one JSON line when it is ready' }).toBe(true);
    served = JSON.parse(stdout.split('\n')[0]) as Served;
  });

  test.afterAll(async () => {
    if (serving?.pid) {
      try { process.kill(process.platform === 'win32' ? serving.pid : -serving.pid, 'SIGTERM'); } catch { /* gone */ }
      await new Promise((r) => setTimeout(r, 1_500));
    }
    await outbound?.close();
    fx?.cleanup();
  });

  test('serve opens the project headless, keeps its data in the cache, and says how to connect', async () => {
    expect(served.project).toBe(fs.realpathSync(fx.projectPath));
    // The platform's own cache (~/Library/Caches on macOS), as the CLI picks it.
    expect(served.dataDir.startsWith(headlessCacheRoot(env(), home))).toBe(true);
    expect(served.counts.files).toBeGreaterThan(0);
    expect(served.counts.symbols).toBeGreaterThan(0);
    expect(served.api).toMatch(/^http:\/\/127\.0\.0\.1:\d+$/);
    expect(served.mcp).toMatch(/^http:\/\/127\.0\.0\.1:\d+\//);
    expect(served.connector.args).toEqual([BIN, 'mcp', '--data-dir', served.dataDir]);
    // Nothing went into the checkout.
    expect(execFileSync('git', ['-C', fx.projectPath, 'status', '--porcelain'], { encoding: 'utf8' })).toBe('');
    expect(fs.existsSync(path.join(served.dataDir, 'capability-token'))).toBe(true);
  });

  test('loopback is not a boundary: without the token every request is refused', async () => {
    expect((await fetch(`${served.api}/api/plans`)).status).toBe(401);
    const token = fs.readFileSync(path.join(served.dataDir, 'capability-token'), 'utf8').trim();
    expect((await fetch(`${served.api}/api/plans`, { headers: { 'x-codetrellis-token': token } })).status).toBe(200);
  });

  test('an agent launched in the project finds it with `codetrellis mcp`, and its calls are an agent\'s', async () => {
    const agent = new Client({ name: 'claude-code', version: '0' }, { capabilities: {} });
    await agent.connect(new StdioClientTransport({ command: process.execPath, args: [BIN, 'mcp'], cwd: fx.projectPath, env: env(), stderr: 'pipe' }));
    try {
      const tools = await agent.listTools();
      expect(tools.tools.map((t) => t.name)).toEqual(expect.arrayContaining(['create_plan', 'get_plan', 'claim_item']));
      const made = await agent.callTool({ name: 'create_plan', arguments: { title: 'Export endpoint', project_path: fx.projectPath } });
      expect(made.isError).toBeFalsy();
      const plan = JSON.parse((made.content as Array<{ text: string }>)[0].text) as { uid: string };
      const token = fs.readFileSync(path.join(served.dataDir, 'capability-token'), 'utf8').trim();
      const events = await (await fetch(`${served.api}/api/agent-events?limit=50`, { headers: { 'x-codetrellis-token': token } })).json() as { events: Array<{ tool?: string; agentType?: string; agent?: string }> } | Array<{ tool?: string; agentType?: string }>;
      const list = Array.isArray(events) ? events : events.events;
      expect(JSON.stringify(list)).toContain('create_plan');
      expect(JSON.stringify(list)).toContain('claude-code');
      expect(plan.uid).toBeTruthy();
    } finally {
      await agent.close();
    }
  });

  test('it asked the network nothing of its own: no update check, no GitHub', async () => {
    await new Promise((r) => setTimeout(r, 2_000));
    expect(outbound.hits).toEqual([]);
  });

  test('scan scans once, prints what it found, and exits', async () => {
    const dataDir = path.join(fx.tmpDir, 'scan-data');
    const [port, mcpPort] = await findFreePorts(2);
    const text = execFileSync(process.execPath, [BIN, 'scan', '--project', fx.projectPath, '--data-dir', dataDir, '--port', String(port), '--mcp-port', String(mcpPort), '--json'], {
      env: env(), encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], timeout: 120_000,
    });
    const got = JSON.parse(text.trim()) as { project: string; files: number; symbols: number; imports: number };
    expect(got.project).toBe(fs.realpathSync(fx.projectPath));
    // At least what serve saw: the agent's plan, made since, is a file in the project too.
    expect(got.files).toBeGreaterThanOrEqual(served.counts.files);
    expect(got.symbols).toBeGreaterThan(0);
    expect(fs.existsSync(path.join(dataDir, 'data.db'))).toBe(true);
  });

  test('help, and a refusal for what it does not know', async () => {
    expect(execFileSync(process.execPath, [BIN, '--help'], { encoding: 'utf8' })).toContain('codetrellis serve');
    let code = 0;
    try { execFileSync(process.execPath, [BIN, 'frobnicate'], { stdio: 'pipe' }); } catch (e) { code = (e as { status: number }).status; }
    expect(code).toBe(2);
  });
});
