/**
 * The Claude Code watcher follows every session in the project and its
 * worktrees, each tagged with its folder (Phase 32 A1.2).
 *
 * It followed one: the first live session whose cwd equalled the opened
 * project exactly. An agent in a worktree — the way parallel work is done —
 * never reached the Timeline. The unit test proves the matching with folders
 * handed in; this proves the running backend builds that list itself, from the
 * opened project and the worktrees git reports.
 */

import { test, expect } from '@playwright/test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { setupHarness, openEventStream, type Harness, type EventStream } from '../harness';

interface Status {
  watching: boolean;
  sessionId: string | null;
  sessions: Array<{ sessionId: string; jsonlPath: string; workstreamRoot: string }>;
}

test.describe.serial('Claude Code watcher — every session, keyed by folder', () => {
  test.setTimeout(120_000);

  let h: Harness;
  let events: EventStream;
  let root: string;
  let worktree: string;
  let outside: string;
  let claudeHome: string;

  /** The two files Claude Code writes for a live session; returns the jsonl. */
  const plant = (sessionId: string, cwd: string): string => {
    const dir = path.join(claudeHome, 'projects', cwd.replace(/\//g, '-'));
    fs.mkdirSync(path.join(claudeHome, 'sessions'), { recursive: true });
    fs.mkdirSync(dir, { recursive: true });
    // This process's pid, so the watcher's liveness check passes.
    fs.writeFileSync(path.join(claudeHome, 'sessions', `${sessionId}.json`), JSON.stringify({ sessionId, cwd, pid: process.pid }));
    const jsonl = path.join(dir, `${sessionId}.jsonl`);
    fs.writeFileSync(jsonl, '');
    return jsonl;
  };
  const status = async () => (await (await h.client.raw('GET', '/api/agent/status')).json()) as Status;
  const same = (a: string, b: string) => fs.realpathSync(a) === fs.realpathSync(b);

  test.beforeAll(async () => {
    h = await setupHarness('claude-watcher-sessions', { env: { CODETRELLIS_WATCHER_POLL_MS: '100' } });
    root = h.fixture.projectPath;
    claudeHome = path.join(h.fixture.dataDir, 'claude-home');
    worktree = `${root}-auth`;
    execFileSync('git', ['-C', root, 'worktree', 'add', '-q', worktree, '-b', 'ws-auth'], {
      env: { ...process.env, GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@x', GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@x' },
    });
    outside = fs.mkdtempSync(path.join(os.tmpdir(), 'ct-not-a-project-'));
    events = await openEventStream(h.backend);
  });

  test.afterAll(async () => {
    await events?.close();
    try { execFileSync('git', ['-C', root, 'worktree', 'remove', '--force', worktree]); } catch { /* */ }
    fs.rmSync(outside, { recursive: true, force: true });
    await h?.teardown();
  });

  test('a session in the project and one in its worktree are both followed', async () => {
    plant('agent-main', root);
    plant('agent-auth', worktree);
    plant('agent-elsewhere', outside);
    // Opening the project starts the watcher.
    await h.client.scanProject(root);

    await expect.poll(async () => (await status()).sessions.map((s) => s.sessionId).sort(), { timeout: 20_000 })
      .toEqual(['agent-auth', 'agent-main']);
    const byId = Object.fromEntries((await status()).sessions.map((s) => [s.sessionId, s.workstreamRoot]));
    expect(same(byId['agent-main'], root)).toBe(true);
    expect(same(byId['agent-auth'], worktree)).toBe(true);

    // The renderer is told about each, with its folder.
    const started = events.ofType('agent-event').map((e) => e.payload).filter((e) => e.type === 'session_start');
    expect(started.map((e) => e.payload.sessionId).sort()).toEqual(['agent-auth', 'agent-main']);
  });

  test("the worktree agent's edits reach the Timeline tagged with its session and folder", async () => {
    const jsonl = path.join(claudeHome, 'projects', worktree.replace(/\//g, '-'), 'agent-auth.jsonl');
    fs.appendFileSync(jsonl, JSON.stringify({
      type: 'assistant',
      message: { content: [{ type: 'tool_use', name: 'Edit', input: { file_path: `${worktree}/src/auth.ts` } }] },
    }) + '\n');

    const edit = await events.waitFor(
      'agent-event',
      (e) => e.type === 'file_changed' && e.payload.sessionId === 'agent-auth',
      15_000,
    );
    expect(edit.payload.file).toBe(`${worktree}/src/auth.ts`);
    expect(same(edit.payload.workstreamRoot, worktree)).toBe(true);
  });
});
