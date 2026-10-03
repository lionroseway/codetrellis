/**
 * Resizing a terminal that is ending never throws.
 *
 * node-pty closes the PTY's fd when its process ends, and `resize` on it
 * throws `ioctl(2) failed, EBADF`. The window resizes its terminal pane over
 * IPC, so each of those was an uncaught exception in the main process (the
 * 0.1.18 demo logged 18 in one second). A terminal that has ended answers a
 * resize with false, whether or not onExit has fired yet.
 */

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ct-terminal-'));
process.env.CODETRELLIS_DATA_DIR = tmp;

let terminals: typeof import('./terminal-service');

before(async () => {
  terminals = await import('./terminal-service');
});

after(() => {
  terminals.killAllTerminals();
  fs.rmSync(tmp, { recursive: true, force: true });
});

test('a resize while the process ends, and after, answers false instead of throwing', async () => {
  const info = terminals.createTerminal({ preset: 'shell', cwd: tmp, cols: 80, rows: 24 });
  const exited = new Promise<void>((resolve) => {
    const off = terminals.onTerminalExit((id) => { if (id === info.id) { off(); resolve(); } });
  });

  // Kill the shell outright, then resize as fast as a dragged pane would,
  // through the gap between the fd closing and onExit.
  process.kill(info.pid, 'SIGKILL');
  let done = false;
  void exited.then(() => { done = true; });
  let n = 0;
  while (!done) {
    assert.doesNotThrow(() => terminals.resizeTerminal(info.id, 80 + (n++ % 7), 24));
    await new Promise((r) => setImmediate(r));
  }

  // After the exit it is a dead terminal, which answers false.
  assert.equal(terminals.resizeTerminal(info.id, 100, 30), false);
});
