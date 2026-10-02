/**
 * Rebuilt nodes keep their place and their measurement, so React Flow does
 * not hide them to measure again (node-click on #226).
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { Node } from '@xyflow/react';
import { preserveNodePositions } from './preserve-node-positions';

const node = (id: string, x: number, extra: Partial<Node> = {}): Node => ({ id, position: { x, y: 0 }, data: {}, ...extra });

test('a node that stays keeps its position and its measurement', () => {
  const before = [node('a', 10, { measured: { width: 180, height: 64 } })];
  const [a] = preserveNodePositions(before, [node('a', 999, { data: { selected: true } })]);
  assert.deepEqual(a.position, { x: 10, y: 0 });
  assert.deepEqual(a.measured, { width: 180, height: 64 });
  assert.deepEqual(a.data, { selected: true });
});

test('a new node comes as it is, and an unmeasured one is not given a size', () => {
  const [a, b] = preserveNodePositions([node('a', 10)], [node('a', 50), node('b', 70)]);
  assert.equal(a.measured, undefined);
  assert.deepEqual(a.position, { x: 10, y: 0 });
  assert.deepEqual(b.position, { x: 70, y: 0 });
});
