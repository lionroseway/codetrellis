/**
 * tsconfig path aliases (Phase 32 A2.2).
 *
 * `readTsconfigPaths` stripped comments with regexes that did not know about
 * strings, so a slash-star inside `"@shared/<star>"` opened a "comment" that
 * the star-slash of an `include` glob closed — deleting `paths` itself. In
 * this repository every frontend import of `@shared/types` therefore resolved
 * to nothing, and no edge in the graph ran from the frontend to shared types.
 */

import { test, describe, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { readTsconfigPaths, stripJsonc } from './system-discovery';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ct-tsconfig-'));
after(() => fs.rmSync(tmp, { recursive: true, force: true }));

describe('readTsconfigPaths', () => {
  test('a tsconfig with a paths alias and an include glob keeps its alias', () => {
    // The shape of this repository's own tsconfig.json.
    fs.writeFileSync(path.join(tmp, 'tsconfig.json'), `{
  "compilerOptions": {
    "strict": true, // comments are allowed
    /* and block ones */
    "paths": {
      "@shared/*": ["src/shared/*"],
    },
  },
  "include": ["src/**/*", "tools/inventory/**/*"]
}`);
    assert.deepEqual(readTsconfigPaths(path.join(tmp, 'tsconfig.json'), tmp), [
      { alias: '@shared', rootPath: path.join(tmp, 'src/shared'), source: 'tsconfig-paths' },
    ]);
  });

  test('baseUrl is honoured', () => {
    fs.writeFileSync(path.join(tmp, 'tsconfig.json'), '{ "compilerOptions": { "baseUrl": "app", "paths": { "@ui": ["ui/index.ts"] } } }');
    assert.deepEqual(readTsconfigPaths(path.join(tmp, 'tsconfig.json'), tmp).map((m) => m.rootPath), [path.join(tmp, 'app/ui/index.ts')]);
  });
});

describe('stripJsonc', () => {
  test('removes comments and trailing commas outside strings, and nothing inside them', () => {
    const src = '{ // line\n "url": "http://example.com//x", /* block */ "glob": "src/**/*", "quoted": "a \\" /* not a comment */", "list": [1, 2,], }';
    assert.deepEqual(JSON.parse(stripJsonc(src)), { url: 'http://example.com//x', glob: 'src/**/*', quoted: 'a " /* not a comment */', list: [1, 2] });
  });
});
