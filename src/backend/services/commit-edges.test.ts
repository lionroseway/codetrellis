/**
 * Dependency edges for a `commit:` side (Phase 32 A5.1): unchanged files keep
 * the graph's edges, changed files are parsed at the commit, an import is
 * resolved against the files that exist there, and past the cap the edges
 * stay unknown with the reason.
 */

import { test, describe, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { commitEdges, clearCommitEdgeCache, MAX_PARSED, type CommitEdgeDeps } from './commit-edges';

const ROOT = '/work/app';

/** A resolver that maps `./x` to `x.ts` beside the importer, if that file exists at the commit. */
function deps(blobs: Record<string, string>, reads: string[][] = []): CommitEdgeDeps {
  return {
    readBlobs: (oids) => {
      reads.push(oids);
      return new Map(oids.filter((o) => o in blobs).map((o) => [o, blobs[o]]));
    },
    parseImports: (_abs, content) => ({
      language: 'typescript',
      imports: [...content.matchAll(/from '([^']+)'/g)].map((m) => ({ source: m[1] })),
    }),
    resolve: (_lang, source, importer, known) => {
      const abs = path.join(path.dirname(importer), `${source}.ts`);
      return known.has(abs) ? abs : null;
    },
    relative: (abs) => path.relative(ROOT, abs),
  };
}

const files = (entries: Record<string, string>) => new Map(Object.entries(entries).map(([rel, hash]) => [rel, { hash }]));

describe('commitEdges', () => {
  beforeEach(() => clearCommitEdgeCache());

  test('a file unchanged since the commit keeps the graph\'s edges, and nothing is parsed', () => {
    const reads: string[][] = [];
    const got = commitEdges({
      projectPath: ROOT,
      files: files({ 'a.ts': 'h1', 'b.ts': 'h2' }),
      oids: new Map([['a.ts', 'o1'], ['b.ts', 'o2']]),
      live: { files: files({ 'a.ts': 'h1', 'b.ts': 'h2' }), edges: new Set(['a.ts->b.ts']) },
    }, deps({}, reads));
    assert.deepEqual(got, { ok: true, edges: new Set(['a.ts->b.ts']), parsed: 0 });
    assert.deepEqual(reads, []);
  });

  test('a file that differs is parsed at the commit: an import it had then is an edge, one it has now is not', () => {
    const got = commitEdges({
      projectPath: ROOT,
      files: files({ 'a.ts': 'old', 'b.ts': 'h2', 'c.ts': 'h3' }),
      oids: new Map([['a.ts', 'oA'], ['b.ts', 'o2'], ['c.ts', 'o3']]),
      // Now a.ts imports b; at the commit it imported c.
      live: { files: files({ 'a.ts': 'new', 'b.ts': 'h2', 'c.ts': 'h3' }), edges: new Set(['a.ts->b.ts']) },
    }, deps({ oA: "import { c } from './c'" }));
    assert.equal(got.ok, true);
    assert.deepEqual(got.ok && [...got.edges], ['a.ts->c.ts']);
  });

  test('an unchanged file whose import lands on a file missing at the commit is parsed, not given a dangling edge', () => {
    const got = commitEdges({
      projectPath: ROOT,
      files: files({ 'a.ts': 'h1' }),
      oids: new Map([['a.ts', 'o1']]),
      live: { files: files({ 'a.ts': 'h1', 'b.ts': 'h2' }), edges: new Set(['a.ts->b.ts']) },
    }, deps({ o1: "import { b } from './b'" }));
    assert.deepEqual(got, { ok: true, edges: new Set(), parsed: 1 });
  });

  test('a file only at the commit is parsed, and a file does not depend on itself', () => {
    const got = commitEdges({
      projectPath: ROOT,
      files: files({ 'gone.ts': 'g', 'b.ts': 'h2' }),
      oids: new Map([['gone.ts', 'oG'], ['b.ts', 'o2']]),
      live: { files: files({ 'b.ts': 'h2' }), edges: new Set() },
    }, deps({ oG: "import { b } from './b'\nimport { me } from './gone'" }));
    assert.deepEqual(got.ok && [...got.edges], ['gone.ts->b.ts']);
  });

  test('a blob parsed once is not read again, for any commit that holds it', () => {
    const reads: string[][] = [];
    const input = {
      projectPath: ROOT,
      files: files({ 'a.ts': 'old', 'c.ts': 'h3' }),
      oids: new Map([['a.ts', 'oA'], ['c.ts', 'o3']]),
      live: { files: files({ 'a.ts': 'new', 'c.ts': 'h3' }), edges: new Set<string>() },
    };
    const d = deps({ oA: "import { c } from './c'" }, reads);
    commitEdges(input, d);
    const again = commitEdges(input, d);
    assert.deepEqual(reads, [['oA']]);
    assert.deepEqual(again.ok && [...again.edges], ['a.ts->c.ts']);
  });

  test('past the cap the edges stay unknown, and the reason says how many files differ', () => {
    const n = MAX_PARSED + 1;
    const many = Object.fromEntries(Array.from({ length: n }, (_, i) => [`f${i}.ts`, 'x']));
    const got = commitEdges({
      projectPath: ROOT,
      files: files(many),
      oids: new Map(Object.keys(many).map((k) => [k, k])),
      live: { files: new Map(), edges: new Set() },
    }, deps({}));
    assert.equal(got.ok, false);
    assert.match(!got.ok ? got.reason : '', new RegExp(`^${n} files differ from the working tree at this commit`));
  });
});
