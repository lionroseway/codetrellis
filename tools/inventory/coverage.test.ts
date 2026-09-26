/**
 * Phase 32 stage 0.3 — "tests for everything" as a guard, not a hope.
 *
 * Every REST route, MCP tool and mobile RPC method must be reached by at
 * least one test (a unit test, or a harness test directly or through a
 * harness helper). Skipped tests don't count.
 *
 * Today's gaps are listed in `untested.json`. The list can only SHRINK:
 *
 *   - something new with no test fails            → write a test for it
 *   - a listed item that gained a test fails      → delete it from the list
 *   - a listed item that no longer exists fails   → delete it from the list
 *
 * So the list is always exactly today's gaps, and every change to it shows
 * up in a diff for someone to see. The same shape as `reachable.test.ts`
 * and the capability-matrix coverage test: enumerate what exists, compare
 * with what's declared, fail loudly.
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { compareCoverage, stripSkippedTests, type Surface } from './extract';

const ALLOWLIST = path.join(__dirname, 'untested.json');
const GUARDED: { surface: Surface; name: string }[] = [
  { surface: 'rest', name: 'REST routes' },
  { surface: 'mcp', name: 'MCP tools' },
  { surface: 'rpc', name: 'mobile RPC methods' },
];

describe('skipped tests are not coverage', () => {
  test('a skipped test and a skipped suite are removed; running tests stay', () => {
    const src = [
      "test('runs', () => { call('/api/kept'); });",
      "test.skip('skipped', () => { call('/api/gone-1'); });",
      "test.describe.skip('suite', () => {",
      "  test('inner (with a paren in a string: \")\")', () => { call('/api/gone-2'); });",
      '});',
      "it.skip(`template ${name}`, () => call('/api/gone-3'));",
    ].join('\n');
    const out = stripSkippedTests(src);
    assert.match(out, /\/api\/kept/);
    assert.doesNotMatch(out, /gone-1|gone-2|gone-3/);
  });

  test('a conditional skip inside a running test is kept', () => {
    const src = "test('pty', () => { test.skip(!ptyAvailable, 'no pty'); call('/api/terminals'); });";
    assert.match(stripSkippedTests(src), /\/api\/terminals/);
  });
});

describe('coverage comparison', () => {
  test('new gaps, stale entries and vanished entries are each named', () => {
    const d = compareCoverage(['a', 'new'], ['a', 'fixed', 'deleted'], ['a', 'new', 'fixed']);
    assert.deepEqual(d.newlyUntested, ['new']);
    assert.deepEqual(d.nowTested, ['fixed']);
    assert.deepEqual(d.gone, ['deleted']);
  });
});

describe('every route, tool and RPC method is tested, or on the shrinking list', () => {
  test('untested.json is exactly today\'s gaps', async () => {
    const { collect } = await import('./run');
    const { rows } = await collect();
    const allowlist = JSON.parse(fs.readFileSync(ALLOWLIST, 'utf8')) as Record<string, string[]>;

    const problems: string[] = [];
    for (const { surface, name } of GUARDED) {
      const existing = rows.filter((r) => r.surface === surface);
      assert.ok(existing.length > 10, `only ${existing.length} ${name} found — the inventory probe did not run`);
      const untested = existing.filter((r) => r.unitTests?.length === 0 && r.harnessTests?.length === 0).map((r) => r.id);
      const d = compareCoverage(untested, allowlist[surface] ?? [], existing.map((r) => r.id));
      for (const id of d.newlyUntested) problems.push(`${name}: ${id} has no test — write one (don't add it to untested.json)`);
      for (const id of d.nowTested) problems.push(`${name}: ${id} is tested now — delete it from untested.json`);
      for (const id of d.gone) problems.push(`${name}: ${id} no longer exists — delete it from untested.json`);
    }
    assert.deepEqual(problems, []);
  });
});
