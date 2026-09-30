/**
 * Our own writes are recognised by content, however late the watcher
 * reports them (Phase 32, found in B7.4). A late event on an export used to
 * re-import it over newer database state, dropping an agent's claim.
 */

import { test, mock, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { stampSelfWrite, wasJustWrittenByUs } from './self-write-tracker';

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ct-self-write-'));
let clock = Date.now();
mock.method(Date, 'now', () => clock);
afterEach(() => { clock += 60_000; });

const write = (name: string, content: string) => {
  const p = path.join(dir, name);
  fs.writeFileSync(p, content);
  return p;
};

test('a file we wrote is ours for as long as it reads as we left it, however late the event', () => {
  const p = write('plan.yaml', 'status: in_progress\n');
  stampSelfWrite(p);
  assert.equal(wasJustWrittenByUs(p), true);
  clock += 5_000; // well past the old one-second window
  assert.equal(wasJustWrittenByUs(p), true);
});

test('once someone else changes it, it is theirs, and stays theirs', () => {
  const p = write('task.yaml', 'title: Show totals\n');
  stampSelfWrite(p);
  fs.writeFileSync(p, 'title: Show totals, per currency\n');
  assert.equal(wasJustWrittenByUs(p), false);
  fs.writeFileSync(p, 'title: Show totals\n'); // back to what we wrote: the stamp is gone
  assert.equal(wasJustWrittenByUs(p), false);
});

test('a deletion falls back to the time window', () => {
  const p = write('old.yaml', 'x: 1\n');
  stampSelfWrite(p);
  fs.unlinkSync(p);
  assert.equal(wasJustWrittenByUs(p), true);
  clock += 1_500;
  assert.equal(wasJustWrittenByUs(p), false);
});

test('a path we never stamped is not ours', () => {
  assert.equal(wasJustWrittenByUs(write('theirs.yaml', 'y: 2\n')), false);
});
