/**
 * Naming the log file does not create it (Phase 32 §0.4g). Without the
 * file logger (web and dev builds, the harness), reading the path used to
 * create an empty log and open a write stream nothing wrote to, so
 * get_logs and the Settings panel saw a log file that was never written.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { getCurrentLogPath, getLogDir, tailLog } from './logger';

test('without the file logger, the path is named and nothing is created', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ct-logpath-'));
  process.env.CODETRELLIS_DATA_DIR = dir;
  try {
    const p = getCurrentLogPath();
    assert.equal(path.dirname(p), getLogDir());
    assert.match(path.basename(p), /^\d{4}-\d{2}-\d{2}\.log$/);
    assert.equal(fs.existsSync(p), false, 'no log file was created');
    assert.equal(fs.existsSync(getLogDir()), false, 'no logs directory was created');
    assert.equal(tailLog(), '');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
