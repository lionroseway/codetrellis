import { test } from 'node:test';
import assert from 'node:assert/strict';
import { compareRuns, type ComparedFinding } from './check-compare';

const f = (path: string, imports: string, rule = 'stripe-via-wrapper'): ComparedFinding => ({ rule, path, imports, strength: 'block', failing: true, words: 'only src/payments/index.ts may import npm:stripe', fix: null });

test('two runs: what is new in the later one, what it fixed, and what stayed, in either order', () => {
  const ci = { at: 1, findings: [f('src/a.ts', 'npm:stripe'), f('src/b.ts', 'npm:stripe')], says: ['■ src/c.ts: Sam set a breakpoint on it; ask them before changing it'] };
  const mine = { at: 2, findings: [f('src/b.ts', 'npm:stripe'), f('src/d.ts', 'npm:stripe')], says: ['✗ src/d.ts now imports npm:stripe, which the rule “x” forbids'] };
  for (const c of [compareRuns(ci, mine), compareRuns(mine, ci)]) {
    assert.deepEqual(c.added.map((x) => x.path), ['src/d.ts']);
    assert.deepEqual(c.fixed.map((x) => x.path), ['src/a.ts']);
    assert.deepEqual(c.unchanged.map((x) => x.path), ['src/b.ts']);
    assert.deepEqual(c.saysAdded, []);
    assert.deepEqual(c.saysGone, ['■ src/c.ts: Sam set a breakpoint on it; ask them before changing it']);
    assert.equal(c.words, '1 new · 2 fixed · 1 unchanged');
  }
});

test('the same file importing something else, or under another rule, is another finding', () => {
  const c = compareRuns({ at: 1, findings: [f('src/a.ts', 'npm:stripe')], says: [] }, { at: 2, findings: [f('src/a.ts', 'npm:stripe-js'), f('src/a.ts', 'npm:stripe', 'other')], says: [] });
  assert.equal(c.words, '2 new · 1 fixed · 0 unchanged');
});
