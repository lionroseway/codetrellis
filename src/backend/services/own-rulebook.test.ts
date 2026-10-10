/**
 * Phase 33 R10 — this repository's own rulebook reads cleanly.
 *
 * `.codetrellis/rules/` gates every pull request here through ci.yml's
 * conformity step. A suite with a problem is read without the rule that has
 * it, so a typo would quietly stop a rule holding: the first draft's calls
 * rule said `call:` for `calls:` and was dropped without a word in CI. And a
 * baseline entry for a rule that no longer exists excuses nothing, so it
 * should not be there.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { readRulebook } from './rulebook';
import { BASELINE_FILE, parseBaseline } from './rule-baseline';

const root = path.resolve(__dirname, '..', '..', '..');

test('every suite in this repository reads with no problems, and holds rules', () => {
  const book = readRulebook(root);
  assert.deepEqual(book.problems, []);
  assert.deepEqual(book.suites.map((s) => s.name).sort(), ['conventions', 'layers', 'native']);
  for (const s of book.suites) assert.ok(s.rules.length > 0, `${s.name} has no rules`);
});

test('the baseline names only rules the rulebook has', () => {
  const ids = new Set(readRulebook(root).suites.flatMap((s) => s.rules.map((r) => r.id)));
  const baseline = parseBaseline(fs.readFileSync(path.join(root, BASELINE_FILE), 'utf8'));
  for (const id of baseline.keys()) assert.ok(ids.has(id), `baseline.yaml names ${id}, which no suite has`);
});
