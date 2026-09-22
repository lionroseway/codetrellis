/**
 * Log retention. Daily files were never removed or bounded: 1.8 GB of
 * logs on one install, single days at 656 MB, on a 99%-full disk.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { pruneOldLogs } from './logger';

test('removes daily logs past the window and nothing else', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ct-logs-'));
  try {
    for (const name of ['2026-09-01.log', '2026-09-07.log', '2026-09-08.log', '2026-09-22.log', 'notes.txt', '2026-01-01.log.bak']) {
      fs.writeFileSync(path.join(dir, name), 'x');
    }
    const removed = pruneOldLogs(dir, new Date('2026-09-22T12:00:00Z'), 14);
    assert.deepEqual(removed.sort(), ['2026-09-01.log', '2026-09-07.log']);
    assert.deepEqual(fs.readdirSync(dir).sort(), ['2026-01-01.log.bak', '2026-09-08.log', '2026-09-22.log', 'notes.txt']);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('a missing directory is not an error', () => {
  assert.deepEqual(pruneOldLogs(path.join(os.tmpdir(), 'ct-no-such-dir-xyz'), new Date()), []);
});
