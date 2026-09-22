/**
 * "The Symbols view sometimes doesn't work."
 *
 * It rarely worked. Symbols shows the symbols of ONE focused file, and:
 *   - switching depth cleared the focus, so find-a-file-then-press-Symbols
 *     always lost the file it was meant to show;
 *   - Symbols with no focus fell through to the cluster overview, so the
 *     button rendered exactly the Clusters view: it looked like a no-op;
 *   - a focus given as an ABSOLUTE path (the code reader selects files
 *     that way) matched no graph node.
 * The fetch side (stale cache across projects, cached error bodies, no
 * loading state) lives in MainCanvas and is covered by its comments.
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import { buildDependencyGraph, type DependencyEdge, type FileSymbol } from './graph-builder';
import { expandedAfterDepthChange } from '../stores/graph-store';

function dep(from: string, to: string): DependencyEdge {
  return { source: `/repo/${from}`, target: `/repo/${to}`, sourceRelative: from, targetRelative: to, specifiers: ['x'] };
}
const EDGES = [dep('src/a.ts', 'src/b.ts'), dep('src/a.ts', 'src/c.ts'), dep('src/b.ts', 'src/c.ts')];
const types = (g: { nodes: { type?: string }[] }) => new Set(g.nodes.map((n) => n.type));

describe('switching view depth', () => {
  test('into Symbols keeps the focused file', () => {
    const next = expandedAfterDepthChange(new Set(['cluster:src', 'src/a.ts']), 'symbol', null);
    assert.deepEqual([...next], ['src/a.ts']);
  });

  test('into Symbols with nothing focused adopts the file selected in the inspector', () => {
    assert.deepEqual([...expandedAfterDepthChange(new Set(), 'symbol', 'src/b.ts')], ['src/b.ts']);
  });

  test('into Clusters or Files still resets, so the overview is not hidden behind a focus', () => {
    assert.equal(expandedAfterDepthChange(new Set(['src/a.ts']), 'package', 'src/a.ts').size, 0);
    assert.equal(expandedAfterDepthChange(new Set(['src/a.ts']), 'file', 'src/a.ts').size, 0);
  });
});

describe('Symbols view output', () => {
  test('with no focus it shows files to pick from, not the cluster overview', () => {
    const symbols = buildDependencyGraph(EDGES, 'symbol', new Set(), new Map(), () => {});
    const clusters = buildDependencyGraph(EDGES, 'package', new Set(), new Map(), () => {});
    assert.ok(types(symbols).has('fileNode'), `got ${[...types(symbols)]}`);
    assert.ok(!types(symbols).has('packageNode'));
    assert.notDeepEqual([...types(symbols)], [...types(clusters)]);
  });

  test('a focused file shows its symbols', () => {
    const sm = new Map<string, FileSymbol[]>([['src/a.ts', [{ name: 'run', kind: 'function' } as FileSymbol]]]);
    const g = buildDependencyGraph(EDGES, 'symbol', new Set(['src/a.ts']), sm, () => {});
    assert.ok(g.nodes.some((n) => n.type === 'symbolNode' && (n.data as { label?: string }).label === 'run'));
  });

  test('a focus given as an absolute path resolves to the same file', () => {
    const sm = new Map<string, FileSymbol[]>([['src/a.ts', [{ name: 'run', kind: 'function' } as FileSymbol]]]);
    const g = buildDependencyGraph(EDGES, 'symbol', new Set(['/repo/src/a.ts']), sm, () => {});
    assert.ok(g.nodes.some((n) => n.type === 'symbolNode'), 'absolute focus matched nothing');
  });
});
