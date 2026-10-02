/**
 * An agent session is bound to the workstream it works in (Phase 32 A1.1).
 *
 * Three ways in, tried in order: the stdio connector reports the folder it
 * was launched in; a client that exposes MCP roots is asked for them; a
 * CodeTrellis terminal names itself. The folder only ever CHOOSES among roots
 * already trusted — the opened project and its git worktrees — and a folder
 * outside all of them leaves the session unbound, still working.
 */

import { test, expect } from '@playwright/test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { setupHarness, createMcpClient, type Harness } from '../harness';

const REPO_ROOT = path.resolve(__dirname, '..', '..');

interface Session { sessionId: string; workstreamRoot: string | null; hostTerminalId: string | null }

test.describe.serial('Session binding', () => {
  test.setTimeout(240_000);

  let h: Harness;
  let root: string;
  let worktree: string;
  let outside: string;
  let connector: { command: string; args: string[]; env: Record<string, string> };

  const sessions = async () => (await (await h.client.raw('GET', '/api/sessions')).json()) as Session[];
  /** The session a connect created: the one id not there before. */
  const newSession = async (before: Session[]) => {
    const known = new Set(before.map((s) => s.sessionId));
    await expect.poll(async () => (await sessions()).filter((s) => !known.has(s.sessionId)).length, { timeout: 10_000 }).toBe(1);
    return (await sessions()).find((s) => !known.has(s.sessionId))!;
  };
  const launchIn = async (cwd: string, env: Record<string, string> = {}) => {
    const agent = new Client({ name: 'claude-code', version: '0' }, { capabilities: {} });
    await agent.connect(new StdioClientTransport({
      command: connector.command, args: connector.args, cwd,
      env: { ...(process.env as Record<string, string>), ...connector.env, ...env },
      stderr: 'pipe',
    }));
    return agent;
  };

  test.beforeAll(async () => {
    h = await setupHarness('session-binding');
    root = h.fixture.projectPath;
    await h.client.scanProject(root);
    worktree = `${root}-auth`;
    execFileSync('git', ['-C', root, 'worktree', 'add', '-q', worktree, '-b', 'ws-auth'], {
      env: { ...process.env, GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@x', GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@x' },
    });
    outside = fs.mkdtempSync(path.join(os.tmpdir(), 'ct-not-a-project-'));
    // The bundle the packaged app ships, so the connector runs from any folder.
    execFileSync('npx', ['vite', 'build', '--config', 'vite.connector.config.ts', '--logLevel', 'error'], { cwd: REPO_ROOT });
    connector = (await (await h.client.raw('GET', '/api/mcp/setup')).json()).connector;
  });

  test.afterAll(async () => {
    try { execFileSync('git', ['-C', root, 'worktree', 'remove', '--force', worktree]); } catch { /* */ }
    fs.rmSync(outside, { recursive: true, force: true });
    await h?.teardown();
  });

  test('an agent launched in a worktree is bound to that worktree', async () => {
    const before = await sessions();
    const agent = await launchIn(path.join(worktree, 'packages'));
    try {
      const s = await newSession(before);
      expect(fs.realpathSync(s.workstreamRoot!)).toBe(fs.realpathSync(worktree));
    } finally {
      await agent.close();
    }
  });

  test('an agent launched in the project itself is bound to the project', async () => {
    const before = await sessions();
    const agent = await launchIn(root);
    try {
      expect((await newSession(before)).workstreamRoot).toBe(root);
    } finally {
      await agent.close();
    }
  });

  test('a folder outside every trusted root leaves the session unbound, and it still works', async () => {
    const before = await sessions();
    const agent = await launchIn(outside);
    try {
      expect((await newSession(before)).workstreamRoot).toBeNull();
      const r = await agent.callTool({ name: 'list_recent_projects', arguments: {} });
      expect(r.isError).toBeFalsy();
    } finally {
      await agent.close();
    }
  });

  test('a client that sends no folder but exposes MCP roots is bound from them', async () => {
    const before = await sessions();
    const agent = createMcpClient({
      mcpPort: h.backend.mcpPort, capabilityToken: h.backend.capabilityToken,
      roots: [outside, worktree],
    });
    await agent.connect();
    try {
      const s = await newSession(before);
      await expect.poll(async () => {
        const now = (await sessions()).find((x) => x.sessionId === s.sessionId);
        return now?.workstreamRoot ? fs.realpathSync(now.workstreamRoot) : null;
      }, { timeout: 10_000 }).toBe(fs.realpathSync(worktree));
    } finally {
      await agent.disconnect();
    }
  });

  test('a CodeTrellis terminal the agent names is recorded; one that does not exist is not', async () => {
    const term = await (await h.client.raw('POST', '/api/terminals', { preset: 'shell', cwd: root, title: 'Agent here' })).json() as { id: string };
    try {
      let before = await sessions();
      const inTerminal = await launchIn(root, { CODETRELLIS_HOST_TERMINAL: term.id });
      try {
        expect(await newSession(before)).toMatchObject({ workstreamRoot: root, hostTerminalId: term.id });
      } finally {
        await inTerminal.close();
      }

      before = await sessions();
      const claimsOne = await launchIn(root, { CODETRELLIS_HOST_TERMINAL: 'no-such-terminal' });
      try {
        expect((await newSession(before)).hostTerminalId).toBeNull();
      } finally {
        await claimsOne.close();
      }
    } finally {
      await h.client.raw('DELETE', `/api/terminals/${term.id}`);
    }
  });
});
