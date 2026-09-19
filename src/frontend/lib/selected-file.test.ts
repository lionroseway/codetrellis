/**
 * A node id is not a path (m10).
 *
 * The code surface read `selectedNodeId` as a file path for every kind of
 * selection. Two of the four kinds are not files:
 *
 *   - a symbol id is `/abs/path/file.ts::function:foo`, which the backend
 *     cannot stat, so it answered 404 "File not found" over an empty pane;
 *   - a directory path is a real path to something that is not a file, so
 *     it answered 400 "Path is a directory".
 *
 * Both rendered as errors, which blamed the filesystem for the user's
 * click. The inspector has routed on `kind` since it was written; this
 * surface did not, and the rule now lives in one place so they cannot
 * drift apart again.
 *
 * Tested here rather than in the browser because it is a pure mapping
 * with four cases — the browser suite covers the DIRECTORY case
 * end-to-end, which is the one a user actually reaches from the sidebar.
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { resolveSelectedFile } from './selected-file';
import type { SelectedNodeKind, SelectedNodeMeta } from '../stores/ui-store';

const NO_META: SelectedNodeMeta = {};
const resolve = (id: string | null, kind: SelectedNodeKind, meta: SelectedNodeMeta = NO_META) =>
  resolveSelectedFile(id, kind, meta);

describe('a file selection', () => {
  test('the id is the path', () => {
    const r = resolve('/repo/src/a.ts', 'file');
    assert.equal(r.filePath, '/repo/src/a.ts');
    assert.equal(r.explanation, null);
  });

  test('an untagged selection is still treated as a file', () => {
    // The sidebar passed no kind at all for a long time, and a great deal
    // of the app selects plain file paths. Defaulting to "file" is what
    // keeps that working.
    assert.equal(resolve('/repo/src/a.ts', null).filePath, '/repo/src/a.ts');
  });
});

describe('a symbol selection', () => {
  test('resolves to its parent file, not to the symbol id', () => {
    const r = resolve('/repo/src/a.ts::function:foo', 'symbol', {
      parentFilePath: '/repo/src/a.ts',
    });
    assert.equal(r.filePath, '/repo/src/a.ts');
    assert.equal(r.explanation, null);
  });

  test('the unopenable id never becomes a path', () => {
    // The precise defect: this string was sent to /api/file/content.
    const r = resolve('/repo/src/a.ts::function:foo', 'symbol', {
      parentFilePath: '/repo/src/a.ts',
    });
    assert.ok(!r.filePath!.includes('::'));
  });

  test('a symbol with no recorded parent explains itself rather than guessing', () => {
    // Splitting the id on '::' would work today and is still a guess about
    // a format that belongs to the graph. A wrong guess is another "File
    // not found", which is the thing being fixed.
    const r = resolve('/repo/src/a.ts::function:foo', 'symbol');
    assert.equal(r.filePath, null);
    assert.match(r.explanation ?? '', /not linked to a file/);
  });
});

describe('a selection that is not a file at all', () => {
  test('a directory is explained, not fetched', () => {
    const r = resolve('/repo/src', 'directory');
    assert.equal(r.filePath, null);
    assert.match(r.explanation ?? '', /directory/i);
  });

  test('a cluster is explained, not fetched', () => {
    const r = resolve('cluster:billing', 'cluster');
    assert.equal(r.filePath, null);
    assert.match(r.explanation ?? '', /several files/i);
  });

  test('the explanation never reads like an error', () => {
    // It is not a failure. The selection is real; it just is not a file.
    for (const [id, kind] of [['/repo/src', 'directory'], ['cluster:x', 'cluster']] as const) {
      const e = resolve(id, kind).explanation ?? '';
      assert.ok(!/not found|cannot|failed|error/i.test(e), e);
    }
  });
});

describe('nothing selected', () => {
  test('is neither a file nor an explanation', () => {
    // The empty state has something better to say than any of these.
    const r = resolve(null, null);
    assert.equal(r.filePath, null);
    assert.equal(r.explanation, null);
  });
});
