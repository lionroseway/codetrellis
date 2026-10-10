/**
 * The published package.json lists what the compiled CLI requires and
 * nothing else, and refuses to build a package that would install without
 * something the CLI needs.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cliManifest, IN_READER_BUNDLE_ONLY, packageOf, requiredPackages, requiresLeftOut } from './manifest';

test('a specifier names its package; built-ins and relative paths name none', () => {
  assert.equal(packageOf('yaml'), 'yaml');
  assert.equal(packageOf('@modelcontextprotocol/sdk/server/mcp.js'), '@modelcontextprotocol/sdk');
  assert.equal(packageOf('ws/lib/x'), 'ws');
  assert.equal(packageOf('node:fs'), null);
  assert.equal(packageOf('fs/promises'), null);
  assert.equal(packageOf('./server'), null);
  assert.equal(packageOf('../../package.json'), null);
});

test('the packages a compiled file requires, by literal name only', () => {
  const src = [
    'var import_yaml = require("yaml");',
    "const { z } = require('zod');",
    'const sdk = require("@modelcontextprotocol/sdk/client/index.js");',
    'const fs = require("node:fs"); const p = require("path");',
    'const s = require("./server");',
    'return require(wtsName);',
  ].join('\n');
  assert.deepEqual(requiredPackages(src).sort(), ['@modelcontextprotocol/sdk', 'yaml', 'zod']);
});

const root = {
  version: '1.2.3',
  license: 'Apache-2.0',
  dependencies: { yaml: '^2', zod: '^4', 'web-tree-sitter': '^0.27.0', react: '^19', electron: 'nope' },
  devDependencies: { tsx: '^4' },
};

test('only what is required, at the repository\'s ranges, plus what a computed require loads', () => {
  const m = cliManifest(root, ['yaml', 'zod', 'electron']);
  assert.deepEqual(m.dependencies, { 'web-tree-sitter': '^0.27.0', yaml: '^2', zod: '^4' });
  assert.equal(m.name, 'codetrellis');
  assert.equal(m.version, '1.2.3');
  assert.deepEqual(m.bin, { codetrellis: 'bin/codetrellis.mjs' });
  assert.deepEqual(m.engines, { node: '>=22' });
});

test('a package the CLI needs but npm would not install is refused at build time', () => {
  assert.throws(() => cliManifest(root, ['tsx']), /tsx \(only a devDependency\)/);
  assert.throws(() => cliManifest(root, ['left-pad']), /left-pad/);
});

test('a compiled file that still requires a source only the reader bundle carries is found', () => {
  const src = [
    'var import_read = require("./read");',
    'var x = require("../material-reader/child.js");',
    'var ok = require("./reader-host");',
    'var y = require("mammoth");',
  ].join('\n');
  assert.deepEqual(
    requiresLeftOut('src/backend/services/material-reader/other.js', src, IN_READER_BUNDLE_ONLY),
    ['src/backend/services/material-reader/read', 'src/backend/services/material-reader/child.js'],
  );
  assert.deepEqual(requiresLeftOut('src/backend/services/reader-host.js', 'require("./material-reader/read")', IN_READER_BUNDLE_ONLY), ['src/backend/services/material-reader/read']);
  assert.deepEqual(requiresLeftOut('src/cli/main.js', 'require("../backend/server")', IN_READER_BUNDLE_ONLY), []);
});
