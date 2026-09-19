/**
 * Unit tests for the overlay's per-line indexing (Phase 26).
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { indexMarkers, markerLabel, hasContent, isSpanStart, type OverlayMarker } from './plan-overlay';

const marker = (over: Partial<OverlayMarker> = {}): OverlayMarker => ({
  itemUid: 'itm_1',
  itemTitle: 'Rotate signing keys',
  itemStatus: 'pending',
  planUid: 'pln_1',
  anchor: 'lines',
  startLine: 10,
  endLine: 12,
  instruction: 'rotate',
  intent: 'modify',
  symbol: null,
  ...over,
});

describe('indexing', () => {
  test('a span expands to every line it covers', () => {
    const index = indexMarkers([marker()]);
    assert.deepEqual([...index.keys()].sort((a, b) => a - b), [10, 11, 12]);
  });

  test('overlapping markers stack on the shared lines', () => {
    const index = indexMarkers([
      marker({ itemUid: 'a', startLine: 10, endLine: 12 }),
      marker({ itemUid: 'b', startLine: 11, endLine: 14 }),
    ]);
    assert.equal(index.get(10)!.length, 1);
    assert.equal(index.get(11)!.length, 2, 'two items want line 11');
    assert.equal(index.get(14)!.length, 1);
  });

  test('markers with no span contribute no lines', () => {
    const index = indexMarkers([
      marker({ anchor: 'file', startLine: null, endLine: null }),
      marker({ anchor: 'unanchored', startLine: null, endLine: null }),
    ]);
    assert.equal(index.size, 0);
  });

  test('a single-line span is one entry', () => {
    const index = indexMarkers([marker({ startLine: 7, endLine: 7 })]);
    assert.deepEqual([...index.keys()], [7]);
  });
});

describe('labelling', () => {
  test('one marker reads as its title', () => {
    assert.equal(markerLabel([marker()]), 'Rotate signing keys');
  });

  test('several are counted rather than hidden', () => {
    // Two items wanting the same lines usually means two pieces of work
    // will collide, which is worth surfacing, not swallowing.
    const label = markerLabel([marker(), marker({ itemTitle: 'Other' })]);
    assert.equal(label, 'Rotate signing keys +1 more');
  });

  test('no markers reads as nothing', () => {
    assert.equal(markerLabel([]), '');
  });
});

describe('span starts', () => {
  test('the label goes on the first line of the span', () => {
    const m = marker({ startLine: 10, endLine: 12 });
    assert.equal(isSpanStart(m, 10), true);
    assert.equal(isSpanStart(m, 11), false);
  });
});

describe('emptiness', () => {
  test('an overlay with nothing in it reports no content', () => {
    assert.equal(
      hasContent({ relativePath: 'a.ts', markers: [], fileLevel: [], unanchored: [], itemCount: 0 }),
      false,
    );
    assert.equal(hasContent(null), false);
  });

  test('unanchored alone still counts as content', () => {
    // It is the case a reader most needs told about: the plan refers to
    // lines this file no longer has.
    assert.equal(
      hasContent({
        relativePath: 'a.ts',
        markers: [],
        fileLevel: [],
        unanchored: [marker({ anchor: 'unanchored', startLine: null, endLine: null })],
        itemCount: 1,
      }),
      true,
    );
  });
});
