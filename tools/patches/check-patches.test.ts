/**
 * Every patch in patches/ is applied (Phase 32 HD4c). This runs in the unit
 * job, after its install, so an install that skipped `patch-package` fails
 * here rather than shipping without the patch.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

// eslint-disable-next-line @typescript-eslint/no-require-imports
const { check, unapplied } = require('../../scripts/check-patches.cjs') as {
  check: (root: string) => Array<{ patch: string; files: string[] }>;
  unapplied: (patch: string, root: string) => string[];
};

test('every patch in patches/ is applied in node_modules', () => {
  assert.deepEqual(check(path.resolve(__dirname, '../..')), []);
});

test('a patch whose result is missing is named, with its file', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ct-patches-'));
  fs.mkdirSync(path.join(root, 'node_modules/x'), { recursive: true });
  const patch = [
    'diff --git a/node_modules/x/a.js b/node_modules/x/a.js',
    '--- a/node_modules/x/a.js',
    '+++ b/node_modules/x/a.js',
    '@@ -1,3 +1,3 @@',
    ' const a = 1;',
    '-const MAX = 1200;',
    '+const MAX = 1024;',
    ' const b = 2;',
    '',
  ].join('\n');
  fs.writeFileSync(path.join(root, 'node_modules/x/a.js'), 'const a = 1;\nconst MAX = 1200;\nconst b = 2;\n');
  assert.deepEqual(unapplied(patch, root), ['node_modules/x/a.js']);
  fs.writeFileSync(path.join(root, 'node_modules/x/a.js'), 'const a = 1;\nconst MAX = 1024;\nconst b = 2;\n');
  assert.deepEqual(unapplied(patch, root), []);
  fs.rmSync(path.join(root, 'node_modules/x/a.js'));
  assert.deepEqual(unapplied(patch, root), ['node_modules/x/a.js (not installed)']);
});
