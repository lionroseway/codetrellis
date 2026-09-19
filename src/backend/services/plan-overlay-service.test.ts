/**
 * Unit tests for the plan overlay (Phase 26, layer A).
 *
 * The three anchor shapes and the fourth outcome — *unanchored* — are
 * the whole design, so that is what these pin. A marker in the wrong
 * place is worse than no marker, because a reader believes it.
 *
 * The two lookups are injected rather than mocked: the logic under test
 * is the placement, not the storage, and a pure function is a better
 * shape for it than a module with a hidden dependency.
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import type { PlanItem } from '../../shared/types';
import { buildFileOverlay } from './plan-overlay-service';

const items: PlanItem[] = [];
const symbols: Array<{ name: string; startLine: number; endLine: number }> = [];

function setItems(next: Array<Partial<PlanItem>>): void {
  items.length = 0;
  next.forEach((i, idx) =>
    items.push({
      uid: i.uid ?? `itm_${idx}`,
      planUid: 'pln_1',
      title: i.title ?? 'An item',
      status: i.status ?? 'pending',
      fileSpecs: i.fileSpecs ?? [],
    } as PlanItem),
  );
}

function setSymbols(next: Array<{ name: string; startLine: number; endLine: number }>): void {
  symbols.length = 0;
  next.forEach((s) => symbols.push(s));
}

const overlay = (lineCount = 100) =>
  buildFileOverlay({
    absolutePath: '/repo/src/auth/session.ts',
    relativePath: 'src/auth/session.ts',
    lineCount,
    plans: ['pln_1'],
    lookupItems: () => items,
    lookupSymbols: () => symbols,
  });

describe('line-anchored edits', () => {
  test('a line range marks exactly those lines', () => {
    setItems([
      {
        title: 'Rotate signing keys',
        fileSpecs: [
          {
            path: 'src/auth/session.ts',
            action: 'modify',
            edits: [{ lineRange: { start: 40, end: 58 }, instruction: 'rotate the key' }],
          },
        ],
      },
    ]);

    const result = overlay();
    assert.equal(result.markers.length, 1);
    assert.equal(result.markers[0].anchor, 'lines');
    assert.equal(result.markers[0].startLine, 40);
    assert.equal(result.markers[0].endLine, 58);
    assert.equal(result.markers[0].itemTitle, 'Rotate signing keys');
  });

  test('markers come back in line order', () => {
    setItems([
      {
        fileSpecs: [
          {
            path: 'src/auth/session.ts',
            action: 'modify',
            edits: [
              { lineRange: { start: 80, end: 82 }, instruction: 'b' },
              { lineRange: { start: 10, end: 12 }, instruction: 'a' },
            ],
          },
        ],
      },
    ]);
    assert.deepEqual(overlay().markers.map((m) => m.startLine), [10, 80]);
  });
});

describe('unanchored — the rule that matters', () => {
  test('a range past the end of the file is reported, never clamped', () => {
    setItems([
      {
        fileSpecs: [
          {
            path: 'src/auth/session.ts',
            action: 'modify',
            edits: [{ lineRange: { start: 40, end: 58 }, instruction: 'rotate' }],
          },
        ],
      },
    ]);

    const result = overlay(30);
    assert.equal(result.markers.length, 0, 'nothing is drawn');
    assert.equal(result.unanchored.length, 1);
    assert.equal(result.unanchored[0].anchor, 'unanchored');
    assert.match(result.unanchored[0].reason!, /the file has 30/);
  });

  test('an inverted range is unanchored', () => {
    setItems([
      {
        fileSpecs: [
          { path: 'src/auth/session.ts', action: 'modify', edits: [{ lineRange: { start: 50, end: 10 }, instruction: 'x' }] },
        ],
      },
    ]);
    assert.equal(overlay().unanchored.length, 1);
  });

  test('a symbol that no longer exists is unanchored, with the name in the reason', () => {
    setSymbols([{ name: 'other', startLine: 1, endLine: 5 }]);
    setItems([
      {
        fileSpecs: [
          { path: 'src/auth/session.ts', action: 'modify', edits: [{ symbol: 'validateToken', instruction: 'x' }] },
        ],
      },
    ]);
    const result = overlay();
    assert.equal(result.markers.length, 0);
    assert.match(result.unanchored[0].reason!, /validateToken/);
  });
});

describe('symbol-anchored edits', () => {
  test('a symbol resolves to its span', () => {
    setSymbols([{ name: 'validateToken', startLine: 22, endLine: 39 }]);
    setItems([
      {
        fileSpecs: [
          { path: 'src/auth/session.ts', action: 'modify', edits: [{ symbol: 'validateToken', instruction: 'x' }] },
        ],
      },
    ]);
    const m = overlay().markers[0];
    assert.equal(m.anchor, 'symbol');
    assert.equal(m.startLine, 22);
    assert.equal(m.endLine, 39);
  });

  test('a bare name finds a qualified symbol — Ruby and Go write them qualified', () => {
    setSymbols([{ name: 'Invoice#post', startLine: 12, endLine: 18 }]);
    setItems([
      {
        fileSpecs: [{ path: 'src/auth/session.ts', action: 'modify', edits: [{ symbol: 'post', instruction: 'x' }] }],
      },
    ]);
    assert.equal(overlay().markers[0].startLine, 12);
  });

  test('a bare name does not anchor to a longer one', () => {
    // `save` must not find `saveAll` — a substring match would.
    setSymbols([{ name: 'saveAll', startLine: 5, endLine: 9 }]);
    setItems([
      {
        fileSpecs: [{ path: 'src/auth/session.ts', action: 'modify', edits: [{ symbol: 'save', instruction: 'x' }] }],
      },
    ]);
    assert.equal(overlay().markers.length, 0);
    assert.equal(overlay().unanchored.length, 1);
  });
});

describe('file-level intent', () => {
  test('a spec with no edits is a file banner, not a whole-file highlight', () => {
    // Marking every line would be noise on every line, and a reader
    // would learn to ignore the overlay entirely.
    setItems([
      { title: 'Rework session handling', fileSpecs: [{ path: 'src/auth/session.ts', action: 'modify' }] },
    ]);
    const result = overlay();
    assert.equal(result.markers.length, 0);
    assert.equal(result.fileLevel.length, 1);
    assert.equal(result.fileLevel[0].anchor, 'file');
    assert.equal(result.fileLevel[0].startLine, null);
  });

  test('an edit with an instruction but no anchor is file-level, not dropped', () => {
    setItems([
      {
        fileSpecs: [
          { path: 'src/auth/session.ts', action: 'modify', edits: [{ instruction: 'tidy the imports' }] },
        ],
      },
    ]);
    assert.equal(overlay().fileLevel.length, 1);
  });

  test('a directory target covers files beneath it', () => {
    setItems([{ fileSpecs: [{ path: 'src/auth', action: 'modify', isDir: true }] }]);
    assert.equal(overlay().fileLevel.length, 1);
  });

  test('a directory target does not cover a same-prefix sibling', () => {
    setItems([{ fileSpecs: [{ path: 'src/au', action: 'modify', isDir: true }] }]);
    assert.equal(overlay().fileLevel.length, 0);
  });
});

describe('restraint', () => {
  test('a file nothing targets gets an empty overlay', () => {
    setItems([{ fileSpecs: [{ path: 'src/billing/invoice.ts', action: 'modify' }] }]);
    const result = overlay();
    assert.equal(result.markers.length, 0);
    assert.equal(result.fileLevel.length, 0);
    assert.equal(result.itemCount, 0);
  });

  test('itemCount counts items, not edits', () => {
    setItems([
      {
        uid: 'itm_a',
        fileSpecs: [
          {
            path: 'src/auth/session.ts',
            action: 'modify',
            edits: [
              { lineRange: { start: 1, end: 2 }, instruction: 'a' },
              { lineRange: { start: 3, end: 4 }, instruction: 'b' },
            ],
          },
        ],
      },
    ]);
    const result = overlay();
    assert.equal(result.markers.length, 2);
    assert.equal(result.itemCount, 1);
  });
});

describe('an edit anchored to a class member (M13)', () => {
  test('a method resolves through its qualified name', () => {
    // TypeScript, Python and PHP store class members as NESTED symbols, and
    // the overlay's default lookup filtered `parent_symbol_id IS NULL` — so a
    // plan declaring `{ symbol: 'save' }` against `class Store { save() {} }`
    // was told there is no such symbol. The languages whose parsers flatten
    // members worked, which is why this read as a missing feature rather than
    // a bug in four languages.
    //
    // The member arrives qualified, which is what the suffix match needs.
    const overlay = buildFileOverlay({
      absolutePath: '/repo/src/store.ts',
      relativePath: 'src/store.ts',
      lineCount: 40,
      planUid: 'plan-1',
      plans: ['plan-1'],
      lookupItems: () => ([{
        uid: 'item-1',
        planUid: 'plan-1',
        title: 'Persist on save',
        kind: 'action',
        status: 'pending',
        fileSpecs: [{ path: 'src/store.ts', intent: 'modify', edits: [{ symbol: 'save', instruction: 'flush first' }] }],
      }] as never),
      lookupSymbols: () => ([
        { name: 'Store', kind: 'class', startLine: 3, endLine: 30, modifiers: [] },
        { name: 'Store.save', kind: 'method', startLine: 12, endLine: 18, modifiers: [] },
      ]),
    });

    const anchored = overlay.markers.find((m) => m.startLine === 12);
    assert.ok(anchored, 'the edit anchors to the method, not to the file: '
      + JSON.stringify(overlay.markers.map((m) => [m.anchor, m.startLine])));
    assert.equal(anchored!.endLine, 18);
  });

  test('a name that is only a suffix of another symbol does not match', () => {
    const overlay = buildFileOverlay({
      absolutePath: '/repo/src/store.ts',
      relativePath: 'src/store.ts',
      lineCount: 40,
      planUid: 'plan-1',
      plans: ['plan-1'],
      lookupItems: () => ([{
        uid: 'item-1',
        planUid: 'plan-1',
        title: 'Persist on save',
        kind: 'action',
        status: 'pending',
        fileSpecs: [{ path: 'src/store.ts', intent: 'modify', edits: [{ symbol: 'save', instruction: 'x' }] }],
      }] as never),
      lookupSymbols: () => ([
        { name: 'Store.saveAll', kind: 'method', startLine: 12, endLine: 18, modifiers: [] },
      ]),
    });
    assert.ok(
      !overlay.markers.some((m) => m.startLine === 12),
      'saveAll is not save — a wider lookup must not become a looser match',
    );
  });
});

describe('the plan parameter narrows, it does not widen (m12)', () => {
  test('a plan outside the project draws nothing', () => {
    // The overlay is the surface whose entire value is that the marker is
    // believed. With two projects open, `?plan=<uid in B>` against a file
    // in A used to render B's item titles, instructions and intents over
    // it — the parameter REPLACED the project's plan list instead of
    // filtering it.
    setItems([
      {
        title: "Another project's work",
        fileSpecs: [
          {
            path: 'src/auth/session.ts',
            action: 'modify',
            edits: [{ lineRange: { start: 1, end: 5 }, instruction: 'do it' }],
          },
        ],
      },
    ]);

    const contaminated = buildFileOverlay({
      absolutePath: '/repo/src/auth/session.ts',
      relativePath: 'src/auth/session.ts',
      lineCount: 100,
      plans: ['pln_1'],
      planUid: 'pln_from_another_project',
      lookupItems: () => items,
      lookupSymbols: () => symbols,
    });

    assert.equal(contaminated.markers.length, 0);
    assert.equal(contaminated.itemCount, 0);
  });

  test('a plan inside the project still narrows to it', () => {
    setItems([
      {
        title: 'Rotate signing keys',
        fileSpecs: [
          {
            path: 'src/auth/session.ts',
            action: 'modify',
            edits: [{ lineRange: { start: 1, end: 5 }, instruction: 'do it' }],
          },
        ],
      },
    ]);

    const scoped = buildFileOverlay({
      absolutePath: '/repo/src/auth/session.ts',
      relativePath: 'src/auth/session.ts',
      lineCount: 100,
      plans: ['pln_1', 'pln_2'],
      planUid: 'pln_1',
      lookupItems: () => items,
      lookupSymbols: () => symbols,
    });

    assert.ok(scoped.markers.length > 0, 'the plan that IS in the project still draws');
  });
});
