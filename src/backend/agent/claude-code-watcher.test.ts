/**
 * The watcher must follow a restarted agent.
 *
 * It used to bind one session for the lifetime of the project. `activeJsonlPath`
 * was cleared by nothing except `stopClaudeCodeWatcher()`, and the watcher is
 * started only from the scan path, so once bound it only ever tailed that one
 * file. Exit Claude Code, start a fresh session in the same directory — which
 * writes a different `<sessionId>.jsonl` — and the watcher kept statting the
 * old, now-static file forever. `tailJsonl` sees `size <= tailPosition`,
 * returns, and reports nothing. The Timeline, the detected-plan banner and
 * token accounting all went quietly dead, with no error anywhere.
 *
 * Nothing caught it because the module read `~/.claude` directly and was
 * therefore untestable. Both directories and the poll cadence are now
 * overridable, which is what lets this file exist at all.
 */

import { test, describe, before, after, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

process.env.CODETRELLIS_CLAUDE_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'ct-claude-'));
process.env.CODETRELLIS_WATCHER_POLL_MS = '20';

const CLAUDE_DIR = process.env.CODETRELLIS_CLAUDE_DIR;
const PROJECT_ROOT = fs.mkdtempSync(path.join(os.tmpdir(), 'ct-proj-'));

/** Events the watcher broadcasts, captured via the server module it calls. */
const started: string[] = [];

let startClaudeCodeWatcher: (root: string) => void;
let stopClaudeCodeWatcher: () => void;

before(async () => {
  // `broadcast` lives in ../server, which boots an Express app on import. Stub
  // it in the module registry before the watcher pulls it in.
  const serverPath = require.resolve('../server');
  require.cache[serverPath] = {
    id: serverPath,
    filename: serverPath,
    loaded: true,
    exports: {
      broadcast: (_channel: string, event: { type?: string; payload?: { sessionId?: string } }) => {
        if (event?.type === 'session_start' && event.payload?.sessionId) {
          started.push(event.payload.sessionId);
        }
      },
    },
  } as unknown as NodeJS.Module;

  const mod = await import('./claude-code-watcher');
  startClaudeCodeWatcher = mod.startClaudeCodeWatcher;
  stopClaudeCodeWatcher = mod.stopClaudeCodeWatcher;
});

afterEach(() => {
  stopClaudeCodeWatcher();
  started.length = 0;
  fs.rmSync(path.join(CLAUDE_DIR, 'sessions'), { recursive: true, force: true });
  fs.rmSync(path.join(CLAUDE_DIR, 'projects'), { recursive: true, force: true });
});

after(() => {
  fs.rmSync(CLAUDE_DIR, { recursive: true, force: true });
  fs.rmSync(PROJECT_ROOT, { recursive: true, force: true });
});

/** Write the pair of files Claude Code leaves behind for a live session. */
function plantSession(sessionId: string, lines: string[] = []): string {
  const sessions = path.join(CLAUDE_DIR, 'sessions');
  const encoded = PROJECT_ROOT.replace(/\//g, '-');
  const projectDir = path.join(CLAUDE_DIR, 'projects', encoded);
  fs.mkdirSync(sessions, { recursive: true });
  fs.mkdirSync(projectDir, { recursive: true });

  fs.writeFileSync(
    path.join(sessions, `${sessionId}.json`),
    // Our own pid, so the liveness check (`process.kill(pid, 0)`) passes.
    JSON.stringify({ sessionId, cwd: PROJECT_ROOT, pid: process.pid }),
  );
  const jsonlPath = path.join(projectDir, `${sessionId}.jsonl`);
  fs.writeFileSync(jsonlPath, lines.map((l) => `${l}\n`).join(''));
  return jsonlPath;
}

const settle = (ms = 150): Promise<void> => new Promise((r) => setTimeout(r, ms));

describe('Claude Code watcher — session binding', () => {
  test('binds to a live session', async () => {
    plantSession('session-one');
    startClaudeCodeWatcher(PROJECT_ROOT);
    await settle();

    assert.deepEqual(started, ['session-one']);
  });

  test('rebinds when the agent restarts under a new session id', async () => {
    plantSession('session-one');
    startClaudeCodeWatcher(PROJECT_ROOT);
    await settle();
    assert.deepEqual(started, ['session-one'], 'precondition: bound to the first session');

    // The agent exits and a fresh one starts in the same directory. Claude Code
    // writes a DIFFERENT jsonl; the old session's record goes away with it.
    fs.rmSync(path.join(CLAUDE_DIR, 'sessions', 'session-one.json'));
    plantSession('session-two');

    // Long enough to cross REBIND_CHECK_TICKS at the test poll cadence.
    await settle(600);

    assert.deepEqual(
      started,
      ['session-one', 'session-two'],
      'the watcher must follow the new session — before the fix it stayed bound '
      + 'to session-one and never reported another thing',
    );
  });

  test('stays bound when the agent exits without a replacement', async () => {
    plantSession('session-one');
    startClaudeCodeWatcher(PROJECT_ROOT);
    await settle();
    fs.rmSync(path.join(CLAUDE_DIR, 'sessions', 'session-one.json'));
    await settle(600);

    // No live session is not the same as a new one: rebinding to nothing would
    // churn session_start events for an agent that simply went away.
    assert.deepEqual(started, ['session-one']);
  });
});
