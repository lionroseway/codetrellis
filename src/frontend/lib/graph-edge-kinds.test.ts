import { test } from 'node:test';
import assert from 'node:assert/strict';
import { edgeKindOf, parseEdgeKinds, visibleEdges, ALL_EDGE_KINDS } from './graph-edge-kinds';

const edges = [
  { id: 'a', data: { importState: 'regular' } },
  { id: 'b', data: { importState: 'planned_add' } },
  { id: 'c', data: { importState: 'cross_system', kind: 'cross_system', protocol: 'http' } },
  { id: 'd', data: { importState: 'symbol_link' } },
  { id: 'e' },
];

test('each edge is an import, a cross-system link or a symbol link, from what the builder set', () => {
  assert.deepEqual(edges.map((e) => edgeKindOf(e)), ['imports', 'imports', 'crossSystem', 'symbolLinks', 'imports']);
});

test('turning imports off keeps the cross-system and symbol links, and planned imports go with the imports', () => {
  assert.deepEqual(visibleEdges(edges, ['crossSystem', 'symbolLinks']).map((e) => e.id), ['c', 'd']);
  assert.deepEqual(visibleEdges(edges, ['imports']).map((e) => e.id), ['a', 'b', 'e']);
  assert.deepEqual(visibleEdges(edges, []), []);
});

test('with every kind on the edges are passed through untouched', () => {
  assert.equal(visibleEdges(edges, ALL_EDGE_KINDS), edges);
});

test('what was saved is read back; nothing saved means all, unknown kinds are dropped', () => {
  assert.deepEqual(parseEdgeKinds(null), [...ALL_EDGE_KINDS]);
  assert.deepEqual(parseEdgeKinds(['symbolLinks', 'nonsense', 'imports']), ['imports', 'symbolLinks']);
  assert.deepEqual(parseEdgeKinds([]), []);
});
