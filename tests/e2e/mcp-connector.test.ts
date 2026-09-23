/**
 * The stdio connector, end to end: a real MCP client launches the real
 * connector as a child process, against a real backend — and then the
 * backend restarts with a new token on a different port.
 *
 * That restart is the whole reason the connector exists. Before it, every
 * copy surface wrote this launch's token into the agent's config, so the
 * next launch left every configured agent refused with 401 until the user
 * re-ran `claude mcp add`. Here the same client, with the same config, keeps
 * working across the restart without being touched.
 */

import { test, expect } from '@playwright/test';
import fs from 'node:fs';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { startBackend, authFetch, REPO_ROOT, tmpDirFor, waitFor, type RunningBackend } from '../harness';

test.describe.serial('MCP stdio connector', () => {
  test.setTimeout(180_000);

  const dataDir = path.join(tmpDirFor('mcp-connector'), 'data');
  let backend: RunningBackend | null = null;
  let client: Client | null = null;

  test.beforeAll(async () => {
    fs.rmSync(path.dirname(dataDir), { recursive: true, force: true });
    fs.mkdirSync(dataDir, { recursive: true });
    // The bundle the packaged app ships. Built here so the config the app
    // hands out below names a script that exists.
    execFileSync('npx', ['vite', 'build', '--config', 'vite.connector.config.ts', '--logLevel', 'error'], { cwd: REPO_ROOT });
    backend = await startBackend({ dataDir });
  });

  test.afterAll(async () => {
    await client?.close().catch(() => {});
    await backend?.stop();
    fs.rmSync(path.dirname(dataDir), { recursive: true, force: true });
  });

  const text = (r: unknown) =>
    ((r as { content?: Array<{ type: string; text?: string }> }).content ?? [])
      .map((c) => c.text ?? '')
      .join('\n');

  test('the backend publishes where it is listening', async () => {
    const endpoint = JSON.parse(fs.readFileSync(path.join(dataDir, 'mcp-endpoint.json'), 'utf-8'));
    expect(endpoint.url).toBe(`http://127.0.0.1:${backend!.mcpPort}/sse`);
  });

  test('connects with a config that holds no token, and identifies the agent by its clientInfo', async () => {
    const transport = new StdioClientTransport({
      command: process.execPath,
      args: ['--import', 'tsx', path.join(REPO_ROOT, 'src/backend/mcp/connector/main.ts'), '--data-dir', dataDir],
      cwd: REPO_ROOT,
      stderr: 'pipe',
    });
    client = new Client({ name: 'claude-code', version: '0.0.0-test' }, { capabilities: {} });
    await client.connect(transport);

    const tools = await client.listTools();
    expect(tools.tools.map((t) => t.name)).toContain('list_recent_projects');
    const result = await client.callTool({ name: 'list_recent_projects', arguments: {} });
    expect(result.isError).toBeFalsy();

    // The connector's HTTP requests do not look like Claude Code; the
    // session must still be attributed to Claude Code, from clientInfo.
    await waitFor(async () => {
      const sessions = await (await authFetch(backend!, '/api/sessions')).json() as Array<{ agentType: string }>;
      return sessions.some((s) => s.agentType === 'claude-code');
    }, { timeoutMs: 10_000, description: 'session attributed to claude-code' });
  });

  test('the config the app hands out holds no secret, and connects exactly as pasted', async () => {
    const setup = await (await authFetch(backend!, '/api/mcp/setup')).json() as {
      connector: { command: string; args: string[]; env: Record<string, string>; config: unknown; claudeCodeCommand: string } | null;
      agentPrompt: string;
    };
    expect(setup.connector).not.toBeNull();
    const c = setup.connector!;
    const token = backend!.capabilityToken;
    expect(JSON.stringify(c.config)).not.toContain(token);
    expect(c.claudeCodeCommand).not.toContain(token);
    expect(setup.agentPrompt).not.toContain(token);
    expect(c.args).toContain(dataDir);

    const pasted = new Client({ name: 'cursor-vscode', version: '0' }, { capabilities: {} });
    await pasted.connect(new StdioClientTransport({
      command: c.command,
      args: c.args,
      env: { ...(process.env as Record<string, string>), ...c.env },
      stderr: 'pipe',
    }));
    try {
      const r = await pasted.callTool({ name: 'list_recent_projects', arguments: {} });
      expect(r.isError).toBeFalsy();
    } finally {
      await pasted.close();
    }
  });

  test('survives a restart with a new token on a new port, with no change to the config', async () => {
    const before = backend!;
    await before.stop();

    // While the app is down, a call is answered — with an instruction, not a
    // hang. Which instruction depends on whether the connector has noticed
    // yet: "not running" as a tool result, or "stopped while in flight" as a
    // protocol error for a request that raced the shutdown.
    const down = await client!.callTool({ name: 'list_recent_projects', arguments: {} }).then(
      (r) => ({ ok: !r.isError, said: text(r) }),
      (err: unknown) => ({ ok: false, said: err instanceof Error ? err.message : String(err) }),
    );
    expect(down.ok).toBe(false);
    expect(down.said).toMatch(/CodeTrellis (is not running|stopped)/);

    backend = await startBackend({ dataDir });
    expect(backend.capabilityToken).not.toBe(before.capabilityToken);
    expect(backend.mcpPort).not.toBe(before.mcpPort);

    await waitFor(async () => {
      const r = await client!.callTool({ name: 'list_recent_projects', arguments: {} });
      return !r.isError;
    }, { timeoutMs: 30_000, intervalMs: 500, description: 'the same client reaches the restarted backend' });
  });
});
