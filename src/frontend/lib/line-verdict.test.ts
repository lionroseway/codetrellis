/**
 * The join that was never computed.
 *
 * The reader drew two signals and compared neither: git's per-line state
 * in one palette, the plan overlay's intent rail in another, both at
 * four percent opacity. "Was this planned, and did it happen?" — the
 * question the product exists to answer — was left to the person reading,
 * per line, from two faint colours.
 *
 * These tests pin the truth table, because it is the kind of thing that
 * looks obvious and gets one case wrong. The case that matters most is
 * `outstanding`: a line the plan wants changed and nobody has touched.
 * It has no git state at all, so any rule driven by git alone reports
 * nothing there — which is exactly the silence that made "0/0 actions"
 * and "satisfied: 3" plausible for so long.
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { lineVerdict, gitMark, verdictTooltip, VERDICT_STYLE } from './line-verdict';

describe('the truth table', () => {
  test('planned and changed is aligned', () => {
    assert.equal(lineVerdict('modified', true), 'aligned');
    assert.equal(lineVerdict('added', true), 'aligned');
  });

  test('changed with nobody asking is drift', () => {
    assert.equal(lineVerdict('modified', false), 'drifted');
    assert.equal(lineVerdict('added', false), 'drifted');
  });

  test('planned and untouched is outstanding', () => {
    // No git state at all. A rule driven by the annotation alone returns
    // nothing here, and the line the plan is waiting on looks ordinary.
    assert.equal(lineVerdict('unchanged', true), 'outstanding');
    assert.equal(lineVerdict(undefined, true), 'outstanding');
  });

  test('neither is null, and null is most lines', () => {
    assert.equal(lineVerdict('unchanged', false), null);
    assert.equal(lineVerdict(undefined, false), null);
  });
});

describe('a plan that targets a file, not lines', () => {
  // Most plans are like this. `fileSpecs` is a list of paths, so an item
  // saying "modify app.rb" produces a marker with no line span, and
  // `indexMarkers` — which expands spans — indexes nothing.
  //
  // Without the file-level fallback every line of correctly executed work
  // reads as DRIFT: changed, and as far as the line knows, nobody asked.
  // A screenshot of work done exactly to order, marked as work nobody
  // wanted, is what caught it.
  test('a changed line in a claimed file is aligned, not drift', () => {
    assert.equal(lineVerdict('modified', false, true), 'aligned');
    assert.equal(lineVerdict('added', false, true), 'aligned');
  });

  test('a line-level claim still wins on its own', () => {
    assert.equal(lineVerdict('modified', true, false), 'aligned');
  });

  test('an unclaimed file still drifts', () => {
    assert.equal(lineVerdict('modified', false, false), 'drifted');
  });

  test('a file-level claim does not make every untouched line outstanding', () => {
    // Otherwise mentioning a file in a plan would mark the whole thing,
    // which is noise rather than information.
    assert.equal(lineVerdict('unchanged', false, true), null);
    assert.equal(lineVerdict(undefined, false, true), null);
  });

  test('a line-level claim on an untouched line is still outstanding', () => {
    assert.equal(lineVerdict('unchanged', true, true), 'outstanding');
  });
});

describe('the verdict is readable without colour', () => {
  test('every verdict has a distinct glyph', () => {
    const glyphs = Object.values(VERDICT_STYLE).map((v) => v.glyph);
    assert.equal(new Set(glyphs).size, glyphs.length, 'two verdicts share a glyph');
  });

  test('glyphs agree with the file-tree vocabulary in Sidebar.tsx', () => {
    // Same question one zoom level up. A second set of symbols for the
    // same three ideas is how surfaces drift apart.
    assert.equal(VERDICT_STYLE.aligned.glyph, '✓');
    assert.equal(VERDICT_STYLE.outstanding.glyph, '◇');
    assert.equal(VERDICT_STYLE.drifted.glyph, '◆');
  });

  test('every verdict says itself in words', () => {
    for (const [name, style] of Object.entries(VERDICT_STYLE)) {
      assert.ok(style.label.length > 8, `${name} has no usable label`);
    }
  });

  test('tints are above the threshold of noticing', () => {
    // The defect that started this: 0.04 opacity. Anything below ~0.08
    // is invisible on a laptop panel in daylight, and it shipped.
    for (const [name, style] of Object.entries(VERDICT_STYLE)) {
      const m = style.row.match(/\[0?\.(\d+)\]/);
      assert.ok(m, `${name} row tint is not an explicit opacity`);
      assert.ok(Number(`0.${m![1]}`) >= 0.08, `${name} tint is ${m![1]} — too faint to see`);
    }
  });
});

describe('git state is kept, just demoted', () => {
  test('marks survive as a secondary signal', () => {
    assert.equal(gitMark('added'), '+');
    assert.equal(gitMark('modified'), '~');
    assert.equal(gitMark('unchanged'), '');
    assert.equal(gitMark(undefined), '');
  });
});

describe('the tooltip answers the question that had nowhere to be asked', () => {
  test('it says whether the claim is on the file or the lines', () => {
    const onFile = verdictTooltip('aligned', 'modified', 'Notifier should format', 'modify', true);
    assert.match(onFile, /this file/);
    const onLines = verdictTooltip('aligned', 'modified', 'Align rounding', 'modify', false);
    assert.match(onLines, /these lines/);
  });

  test('it names the item when there is one', () => {
    const t = verdictTooltip('aligned', 'modified', 'Align rounding in the Go money package', 'modify');
    assert.match(t, /Planned, and changed/);
    assert.match(t, /modified since HEAD/);
    assert.match(t, /Align rounding/);
  });

  test('drift says plainly that nothing claims it', () => {
    const t = verdictTooltip('drifted', 'added', null, null);
    assert.match(t, /no item claims this file/);
  });

  test('an ordinary line still says something true', () => {
    assert.match(verdictTooltip(null, 'unchanged'), /Unchanged/);
  });
});
