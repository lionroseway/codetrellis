/**
 * The npm package's own package.json, worked out from what the compiled CLI
 * actually requires.
 *
 * The repository's package.json is the desktop app's: React, CodeMirror,
 * Electron's tooling, and `tsx` as a dev dependency the source launcher
 * needs. Published as it is, `npm install -g codetrellis` would pull the app's
 * interface in and then fail to start, because npm does not install a
 * package's devDependencies. So the published package lists exactly the
 * packages its compiled files require, at the versions the repository pins,
 * and nothing it does not.
 *
 * Pure: the build passes in the compiled sources and the root package.json.
 */

import { builtinModules } from 'node:module';
import path from 'node:path';

/** Required by name somewhere the scan cannot see (a computed require). */
export const ALWAYS_NEEDED = ['web-tree-sitter'];

/**
 * Required, but only inside the desktop app and behind a guard that never
 * runs anywhere else (`secret-store` asks Electron for its keychain only when
 * `process.versions.electron` is set). Listing it would download Electron.
 */
export const NEVER_SHIPPED = ['electron'];

/**
 * Sources the package carries only inside the material reader's bundle
 * (`reader/material-reader.mjs`, vite.reader.config.ts), so they are not
 * compiled one to one. The reader runs in a process of its own and only that
 * bundle is ever started; these two are its entry and what it reads with.
 * Compiled as well, they would make mammoth and pdf.js dependencies of the
 * package — pdf.js is large, and mammoth's own command line brings argparse 1
 * and with it a sprintf-js no release fixes (GHSA-hp3w-g68c-fv3c) — for code
 * nothing runs. The build refuses a package in which anything requires them.
 */
export const IN_READER_BUNDLE_ONLY = [
  'src/backend/services/material-reader/child.ts',
  'src/backend/services/material-reader/read.ts',
];

const BUILTINS = new Set([...builtinModules, ...builtinModules.map((m) => `node:${m}`)]);

/** The package a bare specifier names: `@scope/name/deep` → `@scope/name`, `name/deep` → `name`. */
export function packageOf(specifier: string): string | null {
  if (!specifier || specifier.startsWith('.') || specifier.startsWith('/') || BUILTINS.has(specifier)) return null;
  if (specifier.startsWith('node:')) return null;
  const parts = specifier.split('/');
  if (specifier.startsWith('@')) return parts.length >= 2 ? `${parts[0]}/${parts[1]}` : null;
  return BUILTINS.has(parts[0]) ? null : parts[0];
}

/** Every package a compiled CommonJS file requires by a literal name. */
export function requiredPackages(source: string): string[] {
  const found = new Set<string>();
  for (const m of source.matchAll(/\brequire\(\s*(["'])([^"'\n]+)\1\s*\)/g)) {
    const pkg = packageOf(m[2]);
    if (pkg) found.add(pkg);
  }
  return [...found];
}

/** Every relative path a compiled CommonJS file requires, as written. */
export function relativeRequires(source: string): string[] {
  return [...source.matchAll(/\brequire\(\s*(["'])(\.{1,2}\/[^"'\n]+)\1\s*\)/g)].map((m) => m[2]);
}

/**
 * The left-out sources a compiled file still requires, by their path in the
 * repository. `file` is the compiled file's path relative to the package
 * (`src/backend/x.js`), which is also its source's path with `.ts` for `.js`.
 */
export function requiresLeftOut(file: string, source: string, leftOut: readonly string[]): string[] {
  const dir = path.posix.dirname(file);
  const strip = (p: string) => p.replace(/\.(ts|js)$/, '');
  const out = new Set(leftOut.map(strip));
  return relativeRequires(source)
    .map((r) => path.posix.normalize(path.posix.join(dir, r)))
    .filter((r) => out.has(strip(r)) || out.has(`${r}/index`));
}

export interface RootPackage {
  version: string;
  license?: string;
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
}

/**
 * The published package.json. Throws when the CLI needs a package the
 * repository installs only for development, or not at all: that is a CLI
 * that works from the checkout and fails for everyone who installs it.
 */
export function cliManifest(root: RootPackage, required: Iterable<string>): Record<string, unknown> {
  const names = new Set([...required, ...ALWAYS_NEEDED].filter((n) => !NEVER_SHIPPED.includes(n)));
  const dependencies: Record<string, string> = {};
  const missing: string[] = [];
  for (const name of [...names].sort()) {
    const range = root.dependencies?.[name];
    if (range) dependencies[name] = range;
    else missing.push(root.devDependencies?.[name] ? `${name} (only a devDependency)` : name);
  }
  if (missing.length) {
    throw new Error(`The CLI requires packages the published package would not install: ${missing.join(', ')}. Move them to dependencies, or stop the CLI requiring them.`);
  }
  return {
    name: 'codetrellis',
    version: root.version,
    description: 'CodeTrellis for agents and CI: run it headless, keep agents on track, check changes against your rules, and download the desktop app.',
    keywords: ['codetrellis', 'mcp', 'ai-agents', 'architecture', 'code-review', 'cli'],
    homepage: 'https://codetrellis.dev',
    repository: { type: 'git', url: 'git+https://github.com/lionroseway/codetrellis.git' },
    bugs: { url: 'https://github.com/lionroseway/codetrellis/issues' },
    license: root.license ?? 'Apache-2.0',
    bin: { codetrellis: 'bin/codetrellis.mjs' },
    engines: { node: '>=22' },
    dependencies,
  };
}
