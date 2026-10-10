/**
 * `npm run build:cli-package` — the `codetrellis` CLI as an npm package, in
 * out/cli-package/, ready for `npm pack` or `npm publish`.
 *
 * From the checkout the CLI runs its TypeScript under tsx (bin/codetrellis.mjs).
 * The package runs compiled JavaScript under plain Node instead, laid out the
 * way the source is (src/cli, src/backend, src/shared, resources/), so every
 * path the backend works out from its own location (the tree-sitter grammars,
 * the CLI's own launcher for the review sink) lands in the same place:
 *
 *   bin/codetrellis.mjs          the launcher
 *   src/**                       compiled one file to one file, not bundled
 *   resources/tree-sitter/*.wasm the grammars
 *   reader/material-reader.mjs   the material reader's bundle
 *   package.json                 only what the compiled files require
 *
 * See docs/claude/cli.md, "Installing from npm".
 */

import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { transformWithEsbuild } from 'vite';
import { cliManifest, requiredPackages, type RootPackage } from './manifest';

const root = path.resolve(__dirname, '..', '..');
const out = path.join(root, 'out', 'cli-package');
const SOURCE_DIRS = ['src/cli', 'src/backend', 'src/shared'];

function walk(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((d) => {
    const p = path.join(dir, d.name);
    return d.isDirectory() ? walk(p) : [p];
  });
}

const isTest = (f: string) => /\.(test|spec)\.ts$/.test(f) || f.split(path.sep).includes('__tests__');

async function main(): Promise<void> {
  fs.rmSync(out, { recursive: true, force: true });
  fs.mkdirSync(out, { recursive: true });

  const files = SOURCE_DIRS.flatMap((d) => walk(path.join(root, d)));
  const sources = files.filter((f) => f.endsWith('.ts') && !f.endsWith('.d.ts') && !isTest(f));

  // One file to one file. Bundling would move every module to one place and
  // break the paths the backend works out from `__dirname`. Through Vite's
  // esbuild, which the repository already has, rather than a dependency of
  // its own.
  for (const f of sources) {
    const { code } = await transformWithEsbuild(fs.readFileSync(f, 'utf8'), f, {
      loader: 'ts',
      format: 'cjs',
      platform: 'node',
      target: 'node22',
      // `await import('../backend/server')` as a require: a native import()
      // does not find a path without its extension.
      supported: { 'dynamic-import': false },
      sourcemap: false,
    });
    const dest = path.join(out, path.relative(root, f)).replace(/\.ts$/, '.js');
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.writeFileSync(dest, code);
  }

  // JSON the sources import (engine-lock.json and the like) keeps its place.
  for (const f of files.filter((f) => f.endsWith('.json') && !isTest(f))) {
    const dest = path.join(out, path.relative(root, f));
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.copyFileSync(f, dest);
  }

  fs.cpSync(path.join(root, 'resources', 'tree-sitter'), path.join(out, 'resources', 'tree-sitter'), { recursive: true });

  execFileSync(process.execPath, [path.join(root, 'node_modules', 'vite', 'bin', 'vite.js'), 'build', '--config', 'vite.reader.config.ts', '--logLevel', 'warn'], { cwd: root, stdio: 'inherit' });
  fs.mkdirSync(path.join(out, 'reader'), { recursive: true });
  fs.copyFileSync(path.join(root, 'out', 'reader', 'material-reader.mjs'), path.join(out, 'reader', 'material-reader.mjs'));

  fs.mkdirSync(path.join(out, 'bin'), { recursive: true });
  fs.writeFileSync(
    path.join(out, 'bin', 'codetrellis.mjs'),
    [
      '#!/usr/bin/env node',
      '// The installed `codetrellis` command: the compiled CLI under plain Node.',
      "import { createRequire } from 'node:module';",
      "createRequire(import.meta.url)('../src/cli/main.js');",
      '',
    ].join('\n'),
    { mode: 0o755 },
  );

  const required = new Set<string>();
  for (const f of walk(path.join(out, 'src')).filter((f) => f.endsWith('.js'))) {
    for (const pkg of requiredPackages(fs.readFileSync(f, 'utf8'))) required.add(pkg);
  }
  const rootPkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8')) as RootPackage;
  fs.writeFileSync(path.join(out, 'package.json'), `${JSON.stringify(cliManifest(rootPkg, required), null, 2)}\n`);

  fs.copyFileSync(path.join(__dirname, 'README.md'), path.join(out, 'README.md'));
  fs.copyFileSync(path.join(root, 'LICENSE'), path.join(out, 'LICENSE'));

  const count = walk(out).length;
  console.log(`Wrote the codetrellis ${rootPkg.version} package to ${path.relative(root, out)}/ (${count} files). Try it: npm pack ./${path.relative(root, out)}`);
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
