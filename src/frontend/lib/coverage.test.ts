/**
 * Unit tests for the coverage explanation layer (Phase 29).
 *
 * The thing under test is not arithmetic — it is the promise that this
 * surface does not present correct behaviour as a defect. Rails
 * autoloading writing no `require` is Rails working; a Swift module's
 * files seeing each other implicitly is Swift working. If those showed
 * up looking like faults, the surface would be worse than not having
 * one, because a reader would learn to ignore it.
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  explainGap, internalPercent, describeHttpGap, sortByAttention,
} from './coverage';

describe('explainGap', () => {
  test('a fully resolved language has nothing to explain', () => {
    assert.equal(explainGap('typescript', 10, 10), null);
    assert.equal(explainGap('swift', 0, 0), null);
  });

  test('languages that genuinely do not write imports down read as inherent', () => {
    // Not a limitation of the tool, and must never be shown as one.
    assert.equal(explainGap('swift', 10, 2)?.kind, 'inherent');
    assert.equal(explainGap('ruby', 10, 2)?.kind, 'inherent');
  });

  test('a language with a gap and no known reason is flagged, not hidden', () => {
    // "We do not know" is the one state worth a reader's attention, so
    // it must not look identical to a language that is fine.
    const gap = explainGap('brainfuck', 10, 2);
    assert.equal(gap?.kind, 'unexplained');
  });

  test('every reason is a sentence about the language, not a warning', () => {
    for (const lang of ['swift', 'ruby', 'csharp', 'kotlin', 'go', 'python']) {
      const gap = explainGap(lang, 10, 1);
      assert.ok(gap, lang);
      assert.ok(gap.text.length > 20, `${lang}: too terse to be an answer`);
      assert.ok(
        !/error|fail|broken|warning|problem|unresolved/i.test(gap.text),
        `${lang}: reads as a fault — "${gap.text}"`,
      );
    }
  });
});

describe('internalPercent', () => {
  test('nothing to link is 100%, not 0%', () => {
    // A project with no imports has not failed at anything.
    assert.equal(internalPercent(0, 0), 100);
  });

  test('rounds to whole numbers', () => {
    assert.equal(internalPercent(3, 1), 33);
    assert.equal(internalPercent(71, 32), 45);
  });
});

describe('describeHttpGap', () => {
  test('no gap says nothing at all', () => {
    assert.equal(describeHttpGap(0, 0), null);
  });

  test('singular and plural both read correctly', () => {
    assert.equal(describeHttpGap(1, 0), '1 endpoint nothing here calls');
    assert.equal(describeHttpGap(2, 0), '2 endpoints nothing here calls');
    assert.equal(describeHttpGap(0, 1), '1 call to something outside this project');
  });

  test('both gaps are joined, not stacked', () => {
    assert.equal(
      describeHttpGap(14, 3),
      '14 endpoints nothing here calls · 3 calls to something outside this project',
    );
  });
});

describe('sortByAttention', () => {
  test('unexplained first, resolved last, biggest gap breaking ties', () => {
    const rows = [
      { language: 'typescript', imports: 20, resolved: 20 },  // fine
      { language: 'swift', imports: 10, resolved: 1 },        // inherent, gap 9
      { language: 'klingon', imports: 4, resolved: 1 },       // unexplained
      { language: 'go', imports: 30, resolved: 10 },          // known-limit, gap 20
      { language: 'ruby', imports: 8, resolved: 6 },          // inherent, gap 2
    ];
    assert.deepEqual(
      sortByAttention(rows).map((r) => r.language),
      ['klingon', 'swift', 'ruby', 'go', 'typescript'],
    );
  });

  test('does not mutate its input', () => {
    const rows = [
      { language: 'go', imports: 2, resolved: 1 },
      { language: 'klingon', imports: 2, resolved: 1 },
    ];
    const before = rows.map((r) => r.language);
    sortByAttention(rows);
    assert.deepEqual(rows.map((r) => r.language), before);
  });
});
