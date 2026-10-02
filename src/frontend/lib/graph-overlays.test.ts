/**
 * The graph's overlays (Phase 32 B3.3): which are on, where the project sits
 * in its repository, and what each workstream and open overlap puts on a file.
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { parseOverlays, projectPrefix, toProjectPath, workCountsByFile, workCountLabel, collisionFiles, fileGrounding, clusterGrounding, type GroundingMapView } from './graph-overlays';
import type { AwarenessSignal, Workstream } from '@shared/types';

const ws = (root: string, branch: string | null, files: Array<[string, number?, number?]>, main = false): Workstream => ({
  root, branch, head: null, main, shape: 'worktree', agents: [], idle: false,
  changes: { base: null, truncated: false, files: files.map(([path, added, removed]) => ({ path, status: 'modified', ...(added === undefined ? {} : { added, removed }) })) },
} as Workstream);

const ROOM = [
  ws('/work/app', 'main', [['src/own.ts', 1, 1]], true),
  ws('/work/app-billing', 'billing-v2', [['src/validators.ts', 12, 3], ['docs/x.md', 2, 0], ['img.png']]),
  ws('/work/app-exports', 'exports', [['src/validators.ts', 4, 0]]),
  ws('branch:cloud', 'cloud', [['packages/web/a.ts', 1, 0]]),
];

describe('which overlays are on', () => {
  test('nothing saved means all; unknown ids are dropped; order is the list\'s', () => {
    assert.deepEqual(parseOverlays(undefined), ['plan', 'workstreams', 'collisions', 'breakpoints', 'tests']);
    assert.deepEqual(parseOverlays(['breakpoints', 'nope', 'plan']), ['plan', 'breakpoints']);
    assert.deepEqual(parseOverlays([]), []);
  });
});

describe('the project inside its repository', () => {
  test('the repository itself, a folder inside it, or outside every checkout', () => {
    assert.equal(projectPrefix('/work/app', ROOM), '');
    assert.equal(projectPrefix('/work/app/packages/web/', ROOM), 'packages/web/');
    assert.equal(projectPrefix('/elsewhere', ROOM), null);
    assert.equal(toProjectPath('packages/web/a.ts', 'packages/web/'), 'a.ts');
    assert.equal(toProjectPath('src/x.ts', 'packages/web/'), null);
  });
});

describe('each other workstream\'s lines on a file', () => {
  test('the open copy is left out, and so is a file with no counts', () => {
    const counts = workCountsByFile(ROOM, '/work/app');
    assert.deepEqual([...counts.keys()].sort(), ['docs/x.md', 'packages/web/a.ts', 'src/validators.ts']);
    assert.deepEqual(counts.get('src/validators.ts'), [{ who: 'billing-v2', added: 12, removed: 3 }, { who: 'exports', added: 4, removed: 0 }]);
  });

  test('a project inside the repository sees only its own files, by its own paths', () => {
    assert.deepEqual([...workCountsByFile(ROOM, '/work/app/packages/web').keys()], ['a.ts']);
  });

  test('on the node, then in words on hover', () => {
    assert.deepEqual(workCountLabel([{ who: 'billing-v2', added: 12, removed: 3 }, { who: 'exports', added: 4, removed: 0 }]), {
      short: '2 workstreams: ＋12 −3, ＋4',
      title: 'billing-v2: 12 lines added, 3 removed\nexports: 4 lines added',
    });
    assert.equal(workCountLabel([{ who: 'exports', added: 0, removed: 2 }]).short, 'exports −2');
  });
});

describe('collision zones', () => {
  const sig = (id: string, state: AwarenessSignal['state'], subject: AwarenessSignal['subject'], kind: AwarenessSignal['kind'] = 'collision') =>
    ({ id, kind, severity: 'medium', subject, workstreams: [], summary: `summary ${id}`, firstSeen: 0, lastSeen: 0, state } as AwarenessSignal);

  test('open or acknowledged overlaps mark their files; intended, dismissed, resolved and other kinds do not', () => {
    const zones = collisionFiles([
      sig('a', 'open', { file: 'src/validators.ts' }),
      sig('b', 'acknowledged', { file: 'src/validators.ts', symbol: 'x' }),
      sig('c', 'intended', { file: 'src/other.ts' }),
      sig('d', 'resolved', { file: 'src/gone.ts' }),
      sig('e', 'open', { files: ['src/stale.ts'] }, 'stale-base'),
    ], '');
    assert.deepEqual([...zones], [['src/validators.ts', ['summary a', 'summary b']]]);
  });

  test('outside the project, or with no place in the repository, nothing', () => {
    assert.equal(collisionFiles([sig('a', 'open', { file: 'src/x.ts' })], 'packages/web/').size, 0);
    assert.equal(collisionFiles([sig('a', 'open', { file: 'src/x.ts' })], null).size, 0);
  });
});

describe('test grounding on the graph (B8.3a)', () => {
  const map: GroundingMapView = {
    hasResults: true,
    files: {
      'src/billing/invoice.ts': { state: 'failing', words: '✗ 1 of 3 tests failing' },
      'src/billing/tax.ts': { state: 'stale', words: '⚠ tests older than the code: it changed after its 2 tests last ran' },
      'src/billing/money.ts': { state: 'passing', words: '✓ 4 tests passing' },
    },
  };

  test('a file: its state as a glyph and in words; "no tests" when results exist and none reach it', () => {
    assert.deepEqual(fileGrounding(map, 'src/billing/invoice.ts'), { state: 'failing', mark: '✗', title: '✗ 1 of 3 tests failing' });
    assert.deepEqual(fileGrounding(map, 'src/billing/readme.ts'), { state: 'untested', mark: '○', title: '○ no tests: no test with a reported result imports it' });
  });

  test('nothing at all before any results, or with the overlay off', () => {
    assert.equal(fileGrounding({ hasResults: false, files: {} }, 'src/a.ts'), undefined);
    assert.equal(fileGrounding(null, 'src/a.ts'), undefined);
    assert.equal(clusterGrounding({ hasResults: false, files: {} }, ['src/a.ts']), undefined);
  });

  test('a cluster sums its files, worst first, with the untested counted on hover', () => {
    assert.deepEqual(clusterGrounding(map, ['src/billing/invoice.ts', 'src/billing/tax.ts', 'src/billing/money.ts', 'src/billing/readme.ts']), {
      state: 'failing',
      short: '✗ 1 · ⚠ 1 · ✓ 1',
      title: '1 file failing\n1 file with tests older than the code\n1 file passing\n1 file with no tests',
    });
    assert.deepEqual(clusterGrounding(map, ['src/other/a.ts', 'src/other/b.ts']), { state: 'untested', short: '○ 2', title: '2 files with no tests' });
  });
});
