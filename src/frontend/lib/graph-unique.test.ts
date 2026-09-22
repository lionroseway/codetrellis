/**
 * Duplicate graph ids leaked the canvas into the ground.
 *
 * React Flow keys edges by id. Two edges with one id, and React keeps one
 * and leaks the other into the DOM on every render, forever. Measured in
 * a live session: 7,070 edge elements for 126 real edges, one of them
 * copied 790 times, panning at 2.6 fps. See `uniqueGraph`.
 *
 * The duplicates are not exotic. `import type { A }` and `import { b }`
 * from one module are two dependency rows for the same pair, so this runs
 * the real builder with exactly that input rather than testing the
 * de-duplication helper on its own.
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import { buildDependencyGraph, uniqueGraph, uniqueNames, type DependencyEdge } from './graph-builder';

function dep(from: string, to: string, specifiers: string[]): DependencyEdge {
  return { source: `/r/${from}`, target: `/r/${to}`, sourceRelative: from, targetRelative: to, specifiers };
}

// A hub needs >= 2 connections to appear, so give each file a few.
const EDGES: DependencyEdge[] = [
  dep('src/a.ts', 'src/b.ts', ['Thing']),
  dep('src/a.ts', 'src/b.ts', ['makeThing']), // same pair, second import statement
  dep('src/a.ts', 'src/c.ts', ['c']),
  dep('src/b.ts', 'src/c.ts', ['c']),
  dep('src/d.ts', 'src/b.ts', ['Thing']),
  dep('src/d.ts', 'src/c.ts', ['c']),
  dep('src/e.ts', 'src/b.ts', ['Thing']), // a second importer of the same name
  dep('src/e.ts', 'src/c.ts', ['c']),
];

function ids<T extends { id: string }>(xs: T[]): string[] {
  return xs.map((x) => x.id);
}

describe('graph ids are unique', () => {
  test('the fixture reproduces the bug: the raw builder emits duplicate edge ids', () => {
    // Guards the guard. If the builder ever stops duplicating on its own,
    // the tests below still pass, but for the wrong reason, and this says so.
    const raw = buildDependencyGraph(EDGES, 'file', new Set(), new Map(), () => {});
    assert.ok(new Set(ids(raw.edges)).size < raw.edges.length, 'raw builder no longer duplicates edge ids');
  });

  test('the files view emits one edge per pair, whatever depEdges holds', () => {
    const raw = buildDependencyGraph(EDGES, 'file', new Set(), new Map(), () => {});
    const g = uniqueGraph(raw);
    assert.equal(new Set(ids(g.edges)).size, g.edges.length, `duplicate edge ids: ${ids(g.edges).join(', ')}`);
    assert.equal(new Set(ids(g.nodes)).size, g.nodes.length);
  });

  test('merging keeps every imported symbol from both rows', () => {
    const g = uniqueGraph(buildDependencyGraph(EDGES, 'file', new Set(), new Map(), () => {}));
    const ab = g.edges.filter((e) => e.source === 'src/a.ts' && e.target === 'src/b.ts');
    assert.equal(ab.length, 1);
    const symbols = (ab[0].data as { symbols?: string[] }).symbols ?? [];
    assert.deepEqual([...symbols].sort(), ['Thing', 'makeThing']);
  });

  test('export chips on a card are unique', () => {
    // b.ts exports `Thing` to two importers (d and e). Flattened, that
    // was `Thing` twice, and the card keys its chips by name.
    const g = uniqueGraph(buildDependencyGraph(EDGES, 'file', new Set(), new Map(), () => {}));
    for (const n of g.nodes) {
      const exports = ((n.data || {}) as { exports?: string[] }).exports ?? [];
      assert.equal(new Set(exports).size, exports.length, `${n.id} repeats an export: ${exports.join(', ')}`);
    }
  });

  test('an already-unique graph is returned as-is, so memoised consumers do not re-render', () => {
    const g = { nodes: [{ id: 'x', position: { x: 0, y: 0 }, data: {} }], edges: [] };
    assert.equal(uniqueGraph(g), g);
  });

  test('uniqueNames keeps first-seen order', () => {
    assert.deepEqual(uniqueNames(['b', 'a', 'b', 'c', 'a']), ['b', 'a', 'c']);
  });
});
