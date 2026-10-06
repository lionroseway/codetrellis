import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fileTouches } from './file-plan-touches';
import type { FileOverlay, OverlayMarker } from './plan-overlay';

const m = (itemUid: string, planUid: string, extra: Partial<OverlayMarker> = {}): OverlayMarker => ({
  itemUid, itemTitle: `Task ${itemUid}`, itemStatus: 'pending', planUid, anchor: 'lines', startLine: 1, endLine: 2,
  instruction: '', intent: null, symbol: null, ...extra,
});
const overlay = (markers: OverlayMarker[], fileLevel: OverlayMarker[] = [], unanchored: OverlayMarker[] = []): FileOverlay => ({
  relativePath: 'src/api.ts', markers, fileLevel, unanchored, itemCount: new Set([...markers, ...fileLevel, ...unanchored].map((x) => x.itemUid)).size,
});

test('tasks are grouped by plan, each once, with the plan\'s title, a glyph and a word, and who holds it', () => {
  const titles = new Map([['p1', 'Exports'], ['p2', 'Auth']]);
  const r = fileTouches(overlay(
    [m('a', 'p1', { itemStatus: 'in_progress', itemAssignee: 'claude-code' }), m('b', 'p2', { itemStatus: 'done' }), m('a', 'p1')],
    [m('c', 'p1', { anchor: 'file', itemStatus: 'blocked' })],
  ), titles);
  assert.deepEqual(r, [
    { planUid: 'p1', title: 'Exports', tasks: [
      { itemUid: 'a', title: 'Task a', glyph: '◐', state: 'in progress', holder: 'claude-code' },
      { itemUid: 'c', title: 'Task c', glyph: '■', state: 'blocked', holder: null },
    ] },
    { planUid: 'p2', title: 'Auth', tasks: [{ itemUid: 'b', title: 'Task b', glyph: '✓', state: 'done', holder: null }] },
  ]);
});

test('a task whose edit could not be placed still counts; no overlay is no plans', () => {
  assert.equal(fileTouches(overlay([], [], [m('u', 'p1', { anchor: 'unanchored' })]), new Map())[0].tasks[0].itemUid, 'u');
  assert.equal(fileTouches(overlay([], [], [m('u', 'p1')]), new Map())[0].title, 'A plan');
  assert.deepEqual(fileTouches(null, new Map()), []);
});
