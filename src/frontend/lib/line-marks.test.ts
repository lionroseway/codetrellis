/**
 * The code view's workstream gutter (Phase 32 B3.2): this copy's own marks,
 * and other workstreams' changes placed on this copy's lines through the base.
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { baseToOwn, gutterMarks, ownGlyph } from './line-marks';
import type { LineHunk, WorkstreamLineChanges } from '@shared/types';

const hunk = (kind: LineHunk['kind'], o: [number, number], n: [number, number], functions: string[] = [], committed = true): LineHunk =>
  ({ kind, old: { start: o[0], lines: o[1] }, new: { start: n[0], lines: n[1] }, functions, committed });
const changes = (workstream: string, branch: string, hunks: LineHunk[]): WorkstreamLineChanges =>
  ({ workstream, branch, path: 'src/v.ts', status: 'changed', hunks, added: 0, removed: 0 });

describe('placing a base line on this copy', () => {
  // This copy added 2 lines after base line 4, and changed base 10–11 into one line.
  const own = [hunk('added', [4, 0], [5, 2]), hunk('changed', [10, 2], [12, 1])];

  test('lines above its own changes stay put; below them, move by what it added and removed', () => {
    assert.equal(baseToOwn(3, own), 3);
    assert.equal(baseToOwn(4, own), 4);
    assert.equal(baseToOwn(5, own), 7);
    assert.equal(baseToOwn(9, own), 11);
    assert.equal(baseToOwn(20, own), 21);
  });

  test('a line this copy changed itself sits at its change', () => {
    assert.equal(baseToOwn(10, own), 12);
    assert.equal(baseToOwn(11, own), 12);
  });
});

describe('the gutter', () => {
  const nameOf = (c: WorkstreamLineChanges) => c.branch ?? c.workstream;
  const mine = changes('/work/app', 'main', [hunk('added', [4, 0], [5, 2], ['a'], false), hunk('removed', [20, 3], [21, 0], ['gone'])]);
  const billing = changes('/work/app-billing', 'billing-v2', [hunk('changed', [16, 3], [16, 4], ['validateCreateOrder'], false)]);
  const exportsCh = changes('/work/app-exports', 'exports', [hunk('added', [12, 0], [13, 1], ['validateCreateUser'])]);
  const quiet: WorkstreamLineChanges = { ...changes('/work/app-docs', 'docs', []), status: 'unchanged' };

  const g = gutterMarks([mine, billing, exportsCh, quiet], '/work/app/', nameOf);

  test('this copy\'s own lines: ＋ where added, − on the line above a removal', () => {
    assert.deepEqual([...g.own.keys()], [5, 6, 21]);
    assert.equal(ownGlyph(g.own.get(5)), '＋');
    assert.equal(ownGlyph(g.own.get(21)), '−');
    assert.equal(g.own.get(5)?.[0].sentence, 'main added 5–6, in a, not committed');
  });

  test('others are placed through the base, and keep their own line numbers in words', () => {
    // billing's base 16–18 sits at 18–20 here, below this copy's two added lines.
    assert.deepEqual([18, 19, 20].map((n) => g.others.get(n)?.map((m) => m.who)), [['billing-v2'], ['billing-v2'], ['billing-v2']]);
    assert.equal(g.others.get(18)?.[0].sentence, 'billing-v2 changed 16–19, in validateCreateOrder, not committed');
    // exports inserted after base line 12: here, line 14.
    assert.deepEqual(g.others.get(14)?.map((m) => m.sentence), ['exports added line 13, in validateCreateUser']);
  });

  test('a workstream that leaves the file alone is not "another" changing it', () => {
    assert.deepEqual(g.otherChanges.map((c) => c.branch), ['billing-v2', 'exports']);
    assert.equal(g.ownChanges?.branch, 'main');
  });

  test('with no copy of its own in the list, every entry is another', () => {
    const none = gutterMarks([billing], '/elsewhere', nameOf);
    assert.equal(none.ownChanges, null);
    assert.equal(none.own.size, 0);
    assert.deepEqual([...none.others.keys()], [16, 17, 18]);
  });
});
