/**
 * The line-history gutter's words (Phase 32 E4): the agent where known
 * (marked when only by timing), else the git author; short ages.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { hunkAt, hunkLabel, shortAge, type LineHistoryData } from './line-history';

const NOW = 100 * 86_400_000;
const h: LineHistoryData = {
  at: 'live', path: 'a.ts', lineCount: 4, uncommitted: 1, command: 'git blame -- a.ts',
  hunks: [{ start: 1, end: 2, sha: 'a' }, { start: 3, end: 3, sha: 'b' }, { start: 4, end: 4, sha: null }],
  commits: {
    a: { sha: 'a', short: 'a', author: 'Sam Lee', email: '', at: NOW - 3 * 86_400_000, subject: 'Round', attribution: { agent: 'codex', how: 'commit message', words: '' } },
    b: { sha: 'b', short: 'b', author: 'Sam Lee', email: '', at: NOW - 2 * 3_600_000, subject: 'Half-even', attribution: { agent: 'cursor', how: 'timing', words: '' } },
  },
};

test('the agent where known, marked when only by timing; the git author otherwise; not committed', () => {
  assert.equal(hunkLabel(h, h.hunks[0], NOW), 'codex · 3d · Round');
  assert.equal(hunkLabel(h, h.hunks[1], NOW), 'cursor? · 2h · Half-even');
  assert.equal(hunkLabel(h, h.hunks[2], NOW), 'Not committed yet');
  assert.equal(hunkLabel({ ...h, commits: { ...h.commits, a: { ...h.commits.a, attribution: null } } }, h.hunks[0], NOW), 'Sam Lee · 3d · Round');
});

test('ages a gutter has room for, and the run a line is in', () => {
  assert.equal(shortAge(NOW - 30_000, NOW), '1m');
  assert.equal(shortAge(NOW - 90 * 86_400_000, NOW), '3mo');
  assert.equal(shortAge(NOW - 800 * 86_400_000, NOW), '2y');
  assert.equal(hunkAt(h, 2)?.sha, 'a');
  assert.equal(hunkAt(h, 9), null);
});
