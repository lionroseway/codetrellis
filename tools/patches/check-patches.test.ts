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

test('line endings do not decide it: a CRLF checkout of the patch, or of the file, still matches', () => {
  // Windows runners check patches/ out with CRLF (#324's `portable` job):
  // patch-package applied the patch and the check said it had not.
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ct-patches-'));
  fs.mkdirSync(path.join(root, 'node_modules/x'), { recursive: true });
  const lf = [
    '--- a/node_modules/x/a.js',
    '+++ b/node_modules/x/a.js',
    '@@ -1,2 +1,2 @@',
    ' const a = 1;',
    '-const MAX = 1200;',
    '+const MAX = 1024;',
    '',
  ].join('\n');
  const crlf = lf.replace(/\n/g, '\r\n');
  fs.writeFileSync(path.join(root, 'node_modules/x/a.js'), 'const a = 1;\nconst MAX = 1024;\n');
  assert.deepEqual(unapplied(crlf, root), []);
  fs.writeFileSync(path.join(root, 'node_modules/x/a.js'), 'const a = 1;\r\nconst MAX = 1024;\r\n');
  assert.deepEqual(unapplied(lf, root), []);
  fs.writeFileSync(path.join(root, 'node_modules/x/a.js'), 'const a = 1;\r\nconst MAX = 1200;\r\n');
  assert.deepEqual(unapplied(crlf, root), ['node_modules/x/a.js']);
});
