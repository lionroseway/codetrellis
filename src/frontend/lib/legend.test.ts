import { test } from 'node:test';
import assert from 'node:assert/strict';
import { edgeLegendKeys, graphLegend, legendFor, nodeLegendKeys } from './legend';

test('an entry appears only when something on screen draws its state', () => {
  const nodes = [{ data: { changeStatus: 'modified' } }, { data: {} }];
  const edges = [{ data: { importState: 'regular' } }];
  assert.deepEqual(graphLegend(nodes, edges).map((e) => e.word), ['modified', 'imports']);
  // A planned add drawn: its entry joins, dashed.
  const more = graphLegend([...nodes, { data: { changeStatus: 'planned_add' } }], [...edges, { data: { importState: 'planned_add' } }]);
  assert.deepEqual(more.map((e) => e.key), ['node:modified', 'node:planned_add', 'edge:import', 'edge:planned_add']);
  assert.equal(more.find((e) => e.key === 'edge:planned_add')?.line?.dash, '8 8');
  // Nothing drawn, nothing listed.
  assert.deepEqual(graphLegend([], []), []);
});

test('a node draws its change, its marks and its tests; an edge its import state', () => {
  assert.deepEqual(nodeLegendKeys({ changeStatus: 'added', planHighlighted: true, collisionTitle: 'x', grounding: { state: 'failing' } }), ['node:added', 'mark:footprint', 'mark:collision', 'tests:failing']);
  assert.deepEqual(nodeLegendKeys({ changeStatus: 'nonsense' }), []);
  assert.deepEqual(edgeLegendKeys({ importState: 'cross_system' }), ['edge:cross_system']);
  assert.deepEqual(edgeLegendKeys(undefined), ['edge:import']);
});

test('each entry carries a glyph or a word, never colour alone, and lists once', () => {
  const all = legendFor(['task:done', 'task:done', 'git:modified', 'lane:commit', 'unknown:key']);
  assert.deepEqual(all.map((e) => [e.glyph, e.word]), [['✓', 'Done'], ['M', 'modified'], ['◉', 'commit']]);
  for (const e of all) assert.ok(e.word.length > 0 && /^#[0-9a-f]{6}$/i.test(e.hex));
});
