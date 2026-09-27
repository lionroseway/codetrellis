/**
 * A stored baseline comes back as the baseline it was (Phase 32 §0.6, bug 9).
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { baselineToJson, baselineFromJson } from './baseline-store';
import type { Baseline } from './diff-engine';

const baseline: Baseline = {
  timestamp: 1000,
  files: new Map([['src/a.ts', { hash: 'h1', symbolCount: 3 }], ['src/b.ts', { hash: 'h2', symbolCount: 0 }]]),
  edges: new Set(['src/a.ts->src/b.ts']),
  commitHash: 'abcdef1234567890',
  shortCommitHash: 'abcdef1',
  source: 'commit',
  dirty: false,
  capturedAt: 2000,
  projectPath: '/work/app',
};

test('round trip: files, edges, where it came from and when', () => {
  const back = baselineFromJson(baselineToJson(baseline), '/work/app');
  assert.deepEqual(back, baseline);
});

test('the project it belongs to comes from the row, not the JSON', () => {
  assert.equal(baselineFromJson(baselineToJson(baseline), '/elsewhere')?.projectPath, '/elsewhere');
});

test('a row this version did not write is ignored rather than trusted', () => {
  assert.equal(baselineFromJson('not json', '/work/app'), null);
  assert.equal(baselineFromJson(JSON.stringify({ files: [], edges: [], capturedAt: 1, source: 'guess' }), '/work/app'), null);
  assert.equal(baselineFromJson(JSON.stringify({ edges: [], capturedAt: 1, source: 'scan' }), '/work/app'), null);
});
