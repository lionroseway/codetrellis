/**
 * Workstreams are derived from git's worktree list and the sessions in each
 * folder (Phase 32 A1.3). Worktrees come from real `git worktree list
 * --porcelain` output, parsed by the same function the app uses.
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { deriveWorkstreams, type ClaudeLogSession } from './workstream-service';
import { parseWorktreePorcelain } from './worktree-service';
import type { AgentSessionInfo, WorkstreamChanges } from '../../shared/types';

const PORCELAIN = `worktree /repo/app
HEAD 1111111111111111111111111111111111111111
branch refs/heads/main

worktree /repo/app-auth
HEAD 2222222222222222222222222222222222222222
branch refs/heads/auth-refresh

worktree /repo/app-billing
HEAD 3333333333333333333333333333333333333333
detached

worktree /repo/app-gone
HEAD 4444444444444444444444444444444444444444
branch refs/heads/old
prunable gitdir file points to non-existent location
`;
const worktrees = parseWorktreePorcelain(PORCELAIN, '/repo/app');
const identity = (p: string) => p;

let n = 0;
function mcp(agentType: string, workstreamRoot: string | null, extra: Partial<AgentSessionInfo> = {}): AgentSessionInfo {
  return {
    sessionId: `mcp-${++n}`, agentType, model: null, activePlanUid: null,
    connectedAt: 0, lastSeen: 1000, status: 'active', workstreamRoot, ...extra,
  };
}
const log = (sessionId: string, workstreamRoot: string): ClaudeLogSession => ({ sessionId, workstreamRoot });
const derive = (mcpSessions: AgentSessionInfo[] = [], claudeSessions: ClaudeLogSession[] = [], realpath = identity, changes?: (f: string) => WorkstreamChanges) =>
  deriveWorkstreams({ worktrees, mcpSessions, claudeSessions, realpath, changes });
const summary = (ws: ReturnType<typeof derive>) =>
  ws.map((w) => ({ root: w.root, shape: w.shape, idle: w.idle, agents: w.agents.map((a) => `${a.agentType}/${a.source}`) }));

describe('deriveWorkstreams', () => {
  test('one per live working tree, in git order, main first; a prunable one is dropped', () => {
    const ws = derive();
    assert.deepEqual(ws.map((w) => [w.root, w.branch, w.main]), [
      ['/repo/app', 'main', true],
      ['/repo/app-auth', 'auth-refresh', false],
      ['/repo/app-billing', null, false],
    ]);
    assert.ok(ws.every((w) => w.idle && w.shape === 'worktree'));
  });

  test('each agent is placed in the folder it is bound to', () => {
    const ws = derive([mcp('claude-code', '/repo/app-auth'), mcp('codex', '/repo/app-billing')]);
    assert.deepEqual(summary(ws).filter((w) => !w.idle), [
      { root: '/repo/app-auth', shape: 'worktree', idle: false, agents: ['claude-code/mcp'] },
      { root: '/repo/app-billing', shape: 'worktree', idle: false, agents: ['codex/mcp'] },
    ]);
  });

  test('two agents in one folder make a shared checkout', () => {
    const ws = derive([mcp('claude-code', '/repo/app'), mcp('cursor', '/repo/app')]);
    assert.equal(ws[0].shape, 'shared');
    assert.equal(ws[0].agents.length, 2);
  });

  test('unbound, inactive and other-repository sessions are not placed', () => {
    const ws = derive([
      mcp('claude-code', null),
      mcp('codex', '/repo/app', { status: 'inactive' }),
      mcp('cursor', '/elsewhere/other-repo'),
    ]);
    assert.ok(ws.every((w) => w.idle));
  });

  test('a Claude session seen both over MCP and in its log counts once', () => {
    const ws = derive([mcp('claude-code', '/repo/app-auth')], [log('cc-1', '/repo/app-auth')]);
    assert.deepEqual(summary(ws)[1].agents, ['claude-code/mcp']);
    assert.equal(ws[1].shape, 'worktree');
  });

  test('a Claude session only in its log is still an agent at work', () => {
    const ws = derive([], [log('cc-1', '/repo/app-billing')]);
    assert.deepEqual(summary(ws)[2], { root: '/repo/app-billing', shape: 'worktree', idle: false, agents: ['claude-code/claude-log'] });
  });

  test('two Claude logs and one connection in one folder are two agents, shared', () => {
    const ws = derive([mcp('claude-code', '/repo/app')], [log('cc-1', '/repo/app'), log('cc-2', '/repo/app')]);
    assert.deepEqual(summary(ws)[0].agents, ['claude-code/mcp', 'claude-code/claude-log']);
    assert.equal(ws[0].shape, 'shared');
  });

  test('a session bound through a symlink lands on the worktree git lists by its real path', () => {
    const realpath = (p: string) => p.replace('/links/auth', '/repo/app-auth');
    const ws = derive([mcp('codex', '/links/auth')], [], realpath);
    assert.deepEqual(summary(ws)[1].agents, ['codex/mcp']);
  });

  test('a worktree left with changes and no agent is still a line of work; a clean one is idle', () => {
    const changes = (f: string): WorkstreamChanges => (f === '/repo/app-billing'
      ? { base: 'abc', files: [{ path: 'src/billing.ts', status: 'modified' }], truncated: false }
      : { base: 'abc', files: [], truncated: false });
    const ws = derive([], [], identity, changes);
    assert.deepEqual(ws.map((w) => [w.root, w.idle, w.changes.files.length]), [
      ['/repo/app', true, 0], ['/repo/app-auth', true, 0], ['/repo/app-billing', false, 1],
    ]);
  });
});
