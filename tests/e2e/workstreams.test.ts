/**
 * Workstreams: each working tree of the repository and the agents in it
 * (Phase 32 A1.3), over REST for the TopBar strip and over MCP for agents.
 *
 * Agents arrive the two ways A1.1 and A1.2 see them: an MCP connection bound
 * to a folder, and a Claude Code session known only from its own log.
 */

import { test, expect } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { setupHarness, createMcpClient, type Harness, type ScriptedMcp } from '../harness';

interface Agent { sessionId: string; agentType: string; source: 'mcp' | 'claude-log' }
interface Workstream { root: string; branch: string | null; main: boolean; shape: 'worktree' | 'shared'; idle: boolean; agents: Agent[]; yours?: boolean }

test.describe.serial('Workstreams', () => {
  test.setTimeout(120_000);

  let h: Harness;
  let root: string;
  let worktree: string;
  let claudeHome: string;
  const agents: ScriptedMcp[] = [];

  const workstreams = async (query = '') => {
    const res = await h.client.raw('GET', `/api/workstreams?project=${encodeURIComponent(root)}${query}`);
    expect(res.status).toBe(200);
    return (await res.json()) as Workstream[];
  };
  const same = (a: string, b: string) => fs.realpathSync(a) === fs.realpathSync(b);
  const find = (ws: Workstream[], folder: string) => ws.find((w) => same(w.root, folder));
  /** An MCP agent whose only folder is `folder`, offered as an MCP root. */
  const connectIn = async (folder: string, clientName: string) => {
    const agent = createMcpClient({
      mcpPort: h.backend.mcpPort, capabilityToken: h.backend.capabilityToken, clientName, roots: [folder],
    });
    await agent.connect();
    agents.push(agent);
    return agent;
  };
  /** A live Claude Code session in `cwd`, as its own session record shows it. */
  const plantClaude = (sessionId: string, cwd: string) => {
    const dir = path.join(claudeHome, 'projects', cwd.replace(/\//g, '-'));
    fs.mkdirSync(path.join(claudeHome, 'sessions'), { recursive: true });
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(claudeHome, 'sessions', `${sessionId}.json`), JSON.stringify({ sessionId, cwd, pid: process.pid }));
    fs.writeFileSync(path.join(dir, `${sessionId}.jsonl`), '');
  };

  test.beforeAll(async () => {
    h = await setupHarness('workstreams', { env: { CODETRELLIS_WATCHER_POLL_MS: '100' } });
    root = h.fixture.projectPath;
    claudeHome = path.join(h.fixture.dataDir, 'claude-home');
    worktree = `${root}-auth`;
    execFileSync('git', ['-C', root, 'worktree', 'add', '-q', worktree, '-b', 'auth-refresh'], {
      env: { ...process.env, GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@x', GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@x' },
    });
    await h.client.scanProject(root);
  });

  test.afterAll(async () => {
    for (const a of agents) await a.disconnect().catch(() => {});
    try { execFileSync('git', ['-C', root, 'worktree', 'remove', '--force', worktree]); } catch { /* */ }
    await h?.teardown();
  });

  test('with no agents, nothing is active; idle worktrees only when asked for', async () => {
    expect(await workstreams()).toEqual([]);
    const idle = await workstreams('&idle=1');
    expect(idle.map((w) => [w.main, w.branch, w.idle])).toEqual([[true, expect.any(String), true], [false, 'auth-refresh', true]]);
  });

  test('an agent bound to the worktree makes that workstream active', async () => {
    await connectIn(worktree, 'codex');
    await expect.poll(async () => find(await workstreams(), worktree)?.agents.map((a) => [a.agentType, a.source]), { timeout: 10_000 })
      .toEqual([['codex', 'mcp']]);
    const ws = await workstreams();
    expect(ws).toHaveLength(1);
    expect(ws[0]).toMatchObject({ branch: 'auth-refresh', main: false, shape: 'worktree', idle: false });
  });

  test('a Claude Code session known only from its log is an agent too', async () => {
    plantClaude('cc-main', root);
    await expect.poll(async () => find(await workstreams(), root)?.agents.map((a) => [a.agentType, a.source]), { timeout: 15_000 })
      .toEqual([['claude-code', 'claude-log']]);
  });

  test('a second agent in the same folder makes it a shared checkout', async () => {
    await connectIn(root, 'cursor');
    await expect.poll(async () => find(await workstreams(), root)?.shape, { timeout: 10_000 }).toBe('shared');
    expect(find(await workstreams(), root)!.agents.map((a) => a.agentType).sort()).toEqual(['claude-code', 'cursor']);
  });

  test('list_workstreams tells an agent which workstream is its own', async () => {
    const res = await agents[0].callTool('list_workstreams', {});
    expect(res.isError).toBeFalsy();
    const body = JSON.parse(res.text) as { project_path: string; workstreams: Workstream[] };
    expect(same(body.project_path, root)).toBe(true);
    const mine = body.workstreams.filter((w) => w.yours);
    expect(mine).toHaveLength(1);
    expect(same(mine[0].root, worktree)).toBe(true);
    expect(find(body.workstreams, root)?.yours).toBe(false);

    const withIdle = await agents[0].callTool('list_workstreams', { project_path: root, include_idle: true });
    expect((JSON.parse(withIdle.text) as { workstreams: Workstream[] }).workstreams).toHaveLength(2);
  });

  test('the project comes from what is opened, not from the caller', async () => {
    expect((await h.client.raw('GET', '/api/workstreams')).status).toBe(400);
    expect((await h.client.raw('GET', `/api/workstreams?project=${encodeURIComponent(path.dirname(root))}`)).status).toBe(403);
    const refused = await agents[0].callTool('list_workstreams', { project_path: path.dirname(root) });
    expect(refused.isError).toBe(true);
    expect(refused.text).toContain('not open');
  });
});
