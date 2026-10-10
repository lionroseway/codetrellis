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
 *   src/**                       compiled one file to one file, not bundled,
 *                                but for what only the reader bundle carries
 *   resources/tree-sitter/*.wasm the grammars
 *   reader/material-reader.mjs   the material reader's bundle
 *   package.json                 only what the compiled files require
 *
 * See docs/claude/cli.md, "Installing from npm".
 */

import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import { builtinModules } from 'node:module';
import path from 'node:path';
import { build as viteBuild, transformWithEsbuild } from 'vite';
import { cliManifest, IN_READER_BUNDLE_ONLY, requiredPackages, requiresLeftOut, type RootPackage } from './manifest';

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

/**
 * werift, as one file, for the CLI the desktop app carries (out/cli-vendor,
 * shipped as `<resources>/cli/node_modules/werift`). The app's own copy in
 * app.asar is not whole: electron-builder prunes the nested node_modules that
 * `@shinyoshiaki/binary-data` resolves `lib/binary-stream` from, which is why
 * electron.vite.config.ts bundles werift into the app's main code. This
 * bundles it the same way, from the same patched ESM entry, so the CLI finds
 * it beside itself before it looks in app.asar. The npm package does not need
 * it: npm installs werift whole.
 */
async function vendorWerift(): Promise<void> {
  const dir = path.join(root, 'out', 'cli-vendor', 'node_modules', 'werift');
  fs.rmSync(path.join(root, 'out', 'cli-vendor'), { recursive: true, force: true });
  const entry = path.join(root, 'out', 'cli-vendor', 'entry.mjs');
  fs.mkdirSync(path.dirname(entry), { recursive: true });
  fs.writeFileSync(entry, "export * from 'werift';\n");
  const builtins = [...builtinModules, ...builtinModules.map((m) => `node:${m}`)];
  // binary-data's bare `lib/…`, `types/…` and `internal/…` requires, each to
  // its file, as electron.vite.config.ts aliases them for the app's main code.
  const nested = path.join(root, 'node_modules', '@shinyoshiaki', 'binary-data', 'src', 'node_modules');
  const alias = Object.fromEntries(['lib', 'types', 'internal'].flatMap((d) =>
    fs.readdirSync(path.join(nested, d)).filter((f) => f.endsWith('.js')).map((f) => [`${d}/${f.slice(0, -3)}`, path.join(nested, d, f)])));
  await viteBuild({
    configFile: false,
    logLevel: 'warn',
    root,
    resolve: { alias },
    build: {
      outDir: dir,
      commonjsOptions: { transformMixedEsModules: true },
      emptyOutDir: true,
      target: 'node22',
      minify: false,
      sourcemap: false,
      ssr: entry,
      rollupOptions: { external: builtins, output: { format: 'cjs', entryFileNames: 'index.js', inlineDynamicImports: true } },
    },
    ssr: { noExternal: true },
  });
  fs.writeFileSync(path.join(dir, 'package.json'), `${JSON.stringify({ name: 'werift', private: true, main: 'index.js' }, null, 2)}\n`);
  fs.rmSync(entry);
}

async function main(): Promise<void> {
  fs.rmSync(out, { recursive: true, force: true });
  fs.mkdirSync(out, { recursive: true });

  const files = SOURCE_DIRS.flatMap((d) => walk(path.join(root, d)));
  const leftOut = new Set(IN_READER_BUNDLE_ONLY.map((f) => path.join(root, f)));
  const sources = files.filter((f) => f.endsWith('.ts') && !f.endsWith('.d.ts') && !isTest(f) && !leftOut.has(f));

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
  const reachesLeftOut: string[] = [];
  for (const f of walk(path.join(out, 'src')).filter((f) => f.endsWith('.js'))) {
    const code = fs.readFileSync(f, 'utf8');
    for (const pkg of requiredPackages(code)) required.add(pkg);
    const rel = path.relative(out, f).split(path.sep).join('/');
    for (const r of requiresLeftOut(rel, code, IN_READER_BUNDLE_ONLY)) reachesLeftOut.push(`${rel} requires ${r}`);
  }
  if (reachesLeftOut.length) {
    throw new Error(`The package leaves out what only the reader bundle carries, but the CLI still requires it: ${reachesLeftOut.join('; ')}. Reach it through the reader (reader-host.ts), or take it off IN_READER_BUNDLE_ONLY in tools/cli-package/manifest.ts.`);
  }
  const rootPkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8')) as RootPackage;
  fs.writeFileSync(path.join(out, 'package.json'), `${JSON.stringify(cliManifest(rootPkg, required), null, 2)}\n`);

  fs.copyFileSync(path.join(__dirname, 'README.md'), path.join(out, 'README.md'));
  fs.copyFileSync(path.join(root, 'LICENSE'), path.join(out, 'LICENSE'));

  await vendorWerift();

  const count = walk(out).length;
  console.log(`Wrote the codetrellis ${rootPkg.version} package to ${path.relative(root, out)}/ (${count} files). Try it: npm pack ./${path.relative(root, out)}`);
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
