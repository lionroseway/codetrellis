/**
 * The canvas keeps its graph unless an answer is this project's graph
 * (graph-answer.ts): a scan in flight, or the backend holding another
 * project, never blanks it.
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { graphAnswer } from './graph-answer';

const ROOT = '/w/app';
const EDGES = [{ source: 'a', target: 'b' }];

describe('what an answer means to the canvas', () => {
  test("this project's edges are the graph, empty or not", () => {
    assert.deepEqual(graphAnswer(200, EDGES, encodeURIComponent(ROOT), ROOT), { kind: 'edges', edges: EDGES });
    assert.deepEqual(graphAnswer(200, [], encodeURIComponent(`${ROOT}/`), ROOT), { kind: 'edges', edges: [] });
  });

  test('a scan in flight is not "no edges": keep what is on screen', () => {
    assert.deepEqual(graphAnswer(503, { scanning: true, project: '/w/other' }, null, ROOT), { kind: 'scanning' });
  });

  test("another project's edges are not this project's graph", () => {
    assert.deepEqual(graphAnswer(200, EDGES, encodeURIComponent('/tmp/app-feature'), ROOT), { kind: 'other-project', project: '/tmp/app-feature' });
  });

  test('no header (an older backend, nothing scanned yet) is taken as it is', () => {
    assert.deepEqual(graphAnswer(200, EDGES, null, ROOT), { kind: 'edges', edges: EDGES });
  });

  test('an error, or a body that is not a list, is an error', () => {
    assert.equal(graphAnswer(500, { error: 'x' }, null, ROOT).kind, 'error');
    assert.equal(graphAnswer(503, { error: 'x' }, null, ROOT).kind, 'error');
    assert.equal(graphAnswer(200, { error: 'x' }, null, ROOT).kind, 'error');
  });
});
