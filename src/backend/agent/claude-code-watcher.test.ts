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
const broadcasted: Array<{ type?: string; payload?: Record<string, unknown> }> = [];

let startClaudeCodeWatcher: (root: string, folders?: () => readonly string[]) => void;
let stopClaudeCodeWatcher: () => void;
let getWatcherStatus: typeof import('./claude-code-watcher').getWatcherStatus;

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
        broadcasted.push(event as { type?: string; payload?: Record<string, unknown> });
        if (event?.type === 'session_start' && event.payload?.sessionId) {
          started.push(event.payload.sessionId);
        }
      },
    },
  } as unknown as NodeJS.Module;

  const mod = await import('./claude-code-watcher');
  startClaudeCodeWatcher = mod.startClaudeCodeWatcher;
  stopClaudeCodeWatcher = mod.stopClaudeCodeWatcher;
  getWatcherStatus = mod.getWatcherStatus;
});

afterEach(() => {
  stopClaudeCodeWatcher();
  started.length = 0;
  broadcasted.length = 0;
  fs.rmSync(path.join(CLAUDE_DIR, 'sessions'), { recursive: true, force: true });
  fs.rmSync(path.join(CLAUDE_DIR, 'projects'), { recursive: true, force: true });
});

after(() => {
  fs.rmSync(CLAUDE_DIR, { recursive: true, force: true });
  fs.rmSync(PROJECT_ROOT, { recursive: true, force: true });
});

/**
 * Write the pair of files Claude Code leaves behind for a live session.
 * `encode` is how Claude names the jsonl folder after the cwd: older releases
 * replaced `/`, current ones every non-alphanumeric character.
 */
function plantSession(
  sessionId: string,
  lines: string[] = [],
  cwd: string = PROJECT_ROOT,
  encode: (cwd: string) => string = (c) => c.replace(/\//g, '-'),
): string {
  const sessions = path.join(CLAUDE_DIR, 'sessions');
  const encoded = encode(cwd);
  const projectDir = path.join(CLAUDE_DIR, 'projects', encoded);
  fs.mkdirSync(sessions, { recursive: true });
  fs.mkdirSync(projectDir, { recursive: true });

  fs.writeFileSync(
    path.join(sessions, `${sessionId}.json`),
    // Our own pid, so the liveness check (`process.kill(pid, 0)`) passes.
    JSON.stringify({ sessionId, cwd, pid: process.pid }),
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

describe('Claude Code watcher — every tool call in a message (Phase 32 bug 3)', () => {
  test('a message with two tool calls yields two events, in order', async () => {
    // Claude Code batches independent calls into one assistant message. The
    // watcher returned on the first `tool_use`, so the second edit was never
    // reported.
    const jsonl = plantSession('session-batch');
    startClaudeCodeWatcher(PROJECT_ROOT);
    await settle();

    fs.appendFileSync(jsonl, JSON.stringify({
      type: 'assistant',
      message: {
        content: [
          { type: 'text', text: 'Updating both files.' },
          { type: 'tool_use', name: 'Edit', input: { file_path: '/repo/src/a.ts' } },
          { type: 'tool_use', name: 'Write', input: { file_path: '/repo/src/b.ts' } },
        ],
      },
    }) + '\n');
    await settle();

    const edits = broadcasted
      .filter((e) => e.type === 'file_changed')
      .map((e) => [e.payload?.action, e.payload?.file]);
    assert.deepEqual(edits, [['edit', '/repo/src/a.ts'], ['write', '/repo/src/b.ts']]);
  });
});

describe('Claude Code watcher — the time the agent acted (Phase 32 B1.2)', () => {
  test('an event carries the entry\'s own time, not when the watcher read it; a missing or future one falls back', async () => {
    const jsonl = plantSession('session-time');
    startClaudeCodeWatcher(PROJECT_ROOT);
    await settle();
    const edit = (file: string, timestamp?: string) => JSON.stringify({
      type: 'assistant', ...(timestamp ? { timestamp } : {}),
      message: { content: [{ type: 'tool_use', name: 'Edit', input: { file_path: file } }] },
    });
    const before = Date.now();
    fs.appendFileSync(jsonl, [
      edit('/repo/then.ts', '2026-09-28T09:15:00.000Z'),
      edit('/repo/unstamped.ts'),
      edit('/repo/future.ts', new Date(before + 3_600_000).toISOString()),
    ].join('\n') + '\n');
    await settle();
    const at = Object.fromEntries(broadcasted.filter((e) => e.type === 'file_changed')
      .map((e) => [e.payload?.file, (e as { timestamp?: number }).timestamp]));
    assert.equal(at['/repo/then.ts'], Date.parse('2026-09-28T09:15:00.000Z'));
    for (const f of ['/repo/unstamped.ts', '/repo/future.ts']) {
      assert.ok(at[f]! >= before && at[f]! <= Date.now(), `${f} falls back to when it was read`);
    }
  });
});

describe('Claude Code watcher — every session, keyed by folder (Phase 32 A1.2)', () => {
  // Two worktrees of one repository, as `git worktree add` lays them out: the
  // second lives INSIDE the first's tree, so matching must pick the deepest.
  const MAIN = fs.mkdtempSync(path.join(os.tmpdir(), 'ct-main-'));
  const WORKTREE = path.join(MAIN, '.worktrees', 'feature');
  const OUTSIDE = fs.mkdtempSync(path.join(os.tmpdir(), 'ct-elsewhere-'));
  fs.mkdirSync(path.join(WORKTREE, 'packages', 'api'), { recursive: true });
  const folders = () => [MAIN, WORKTREE];

  after(() => {
    fs.rmSync(MAIN, { recursive: true, force: true });
    fs.rmSync(OUTSIDE, { recursive: true, force: true });
  });

  const editLine = (file: string) => JSON.stringify({
    type: 'assistant',
    message: { content: [{ type: 'tool_use', name: 'Edit', input: { file_path: file } }] },
  });
  const starts = () => broadcasted
    .filter((e) => e.type === 'session_start')
    .map((e) => [e.payload?.sessionId, e.payload?.workstreamRoot])
    .sort();

  test('follows a session in each worktree at once, each tagged with its folder', async () => {
    plantSession('agent-main', [], MAIN);
    plantSession('agent-feature', [], WORKTREE);
    startClaudeCodeWatcher(MAIN, folders);
    await settle();

    // Before A1.2 the watcher took the first live session whose cwd equalled
    // the opened project, so the worktree's agent was never seen at all.
    assert.deepEqual(starts(), [['agent-feature', WORKTREE], ['agent-main', MAIN]]);
    assert.deepEqual(
      getWatcherStatus().sessions.map((s) => [s.sessionId, s.workstreamRoot]).sort(),
      [['agent-feature', WORKTREE], ['agent-main', MAIN]],
    );
  });

  test("each event carries the session and folder it came from", async () => {
    const a = plantSession('agent-main', [], MAIN);
    const b = plantSession('agent-feature', [], WORKTREE);
    startClaudeCodeWatcher(MAIN, folders);
    await settle();

    fs.appendFileSync(a, editLine(`${MAIN}/src/a.ts`) + '\n');
    fs.appendFileSync(b, editLine(`${WORKTREE}/src/b.ts`) + '\n');
    await settle();

    const edits = broadcasted
      .filter((e) => e.type === 'file_changed')
      .map((e) => [e.payload?.sessionId, e.payload?.workstreamRoot, path.basename(String(e.payload?.file))])
      .sort();
    assert.deepEqual(edits, [
      ['agent-feature', WORKTREE, 'b.ts'],
      ['agent-main', MAIN, 'a.ts'],
    ]);
  });

  test('an agent run from a package folder belongs to the worktree it is in', async () => {
    plantSession('agent-pkg', [], path.join(WORKTREE, 'packages', 'api'));
    startClaudeCodeWatcher(MAIN, folders);
    await settle();
    // The deepest folder wins: MAIN contains it too, but it is the worktree's.
    assert.deepEqual(starts(), [['agent-pkg', WORKTREE]]);
  });

  test('a session outside every trusted folder is not followed', async () => {
    plantSession('agent-elsewhere', [], OUTSIDE);
    startClaudeCodeWatcher(MAIN, folders);
    await settle();
    assert.deepEqual(starts(), []);
    assert.deepEqual(getWatcherStatus().sessions, []);
  });

  test("finds a jsonl under Claude's current folder naming", async () => {
    // Current Claude Code turns every non-alphanumeric character into "-", so
    // `.worktrees` does not appear as it would under the older "/"-only rule.
    plantSession('agent-dotted', [], WORKTREE, (c) => c.replace(/[^a-zA-Z0-9]/g, '-'));
    startClaudeCodeWatcher(MAIN, folders);
    await settle();
    assert.deepEqual(starts(), [['agent-dotted', WORKTREE]]);
  });

  test('a line still being written is read once, when it is complete', async () => {
    const a = plantSession('agent-main', [], MAIN);
    startClaudeCodeWatcher(MAIN, folders);
    await settle();

    const line = editLine(`${MAIN}/src/half.ts`);
    fs.appendFileSync(a, line.slice(0, 40));
    await settle();
    fs.appendFileSync(a, line.slice(40) + '\n');
    await settle();

    // Reading to the end of the file parsed the first half, failed, and moved
    // past it — the edit was never reported.
    const edits = broadcasted.filter((e) => e.type === 'file_changed').map((e) => path.basename(String(e.payload?.file)));
    assert.deepEqual(edits, ['half.ts']);
  });

  test('an agent that exits is read one last time, then dropped without an event', async () => {
    const a = plantSession('agent-main', [], MAIN);
    plantSession('agent-feature', [], WORKTREE);
    startClaudeCodeWatcher(MAIN, folders);
    await settle();

    // Its last words and its exit land between two looks.
    fs.appendFileSync(a, editLine(`${MAIN}/src/last.ts`) + '\n');
    fs.rmSync(path.join(CLAUDE_DIR, 'sessions', 'agent-main.json'));
    await settle(600);

    const edits = broadcasted.filter((e) => e.type === 'file_changed').map((e) => path.basename(String(e.payload?.file)));
    assert.deepEqual(edits, ['last.ts']);
    assert.deepEqual(getWatcherStatus().sessions.map((s) => s.sessionId), ['agent-feature']);
    assert.equal(getWatcherStatus().sessionId, 'agent-feature');
    assert.equal(broadcasted.filter((e) => e.type === 'session_start').length, 2, 'no event for the exit');
  });
});
