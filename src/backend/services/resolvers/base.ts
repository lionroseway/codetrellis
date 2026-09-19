/**
 * Per-language import resolver plugin contract.
 *
 * Mirrors the parser plugin shape: one file per language, registered
 * in resolvers/index.ts. Each resolver knows its language's import
 * resolution rules (TS path aliases, Python project-relative,
 * Rust crate-relative, PHP PSR-4, Java package-dir, etc.).
 */

import path from 'node:path';

import type { AliasMapping, DiscoveredSystem, SupportedLanguage } from '../../../shared/types';

export interface ResolveContext {
  /** The raw import source string from the AST extractor. */
  importSource: string;
  /** Absolute path of the file doing the importing. */
  importerPath: string;
  /** Project root (from /api/project/scan). */
  projectRoot: string;
  /** Every file in the project DB — used to verify candidate hits. */
  knownFiles: Set<string>;
  /** TS path aliases + npm package names. */
  aliasMap: AliasMapping[];
  /** All discovered systems — used by per-language resolvers to find the importer's nearest ancestor system root. */
  systems: DiscoveredSystem[];
  /**
   * The import was written in a form that resolves relative to the
   * importing file. Only meaningful where the language cannot express
   * that in `importSource` itself — Ruby's `require_relative 'x'` versus
   * `require 'x'` (Phase 27). Every other language so far encodes it in
   * the string.
   */
  isRelative?: boolean;
}

export interface ResolverPlugin {
  /** Languages this resolver handles. A resolver can claim more than one (TS+JS share rules). */
  languages: ReadonlyArray<SupportedLanguage>;
  /** Resolve and return an absolute file path on hit, null on miss. */
  resolve(ctx: ResolveContext): string | null;
}

/**
 * Find the nearest ancestor system for an absolute file path. Used by
 * per-language resolvers that need a "project root" different from
 * the overall projectRoot (e.g. Python `from app.routes import x`
 * should resolve from the Python system root, not the npm root).
 */
export function findContainingSystem(
  filePath: string,
  systems: DiscoveredSystem[],
): DiscoveredSystem | null {
  let best: DiscoveredSystem | null = null;
  for (const sys of systems) {
    if (filePath === sys.rootPath || filePath.startsWith(sys.rootPath + '/')) {
      if (!best || sys.rootPath.length > best.rootPath.length) best = sys;
    }
  }
  return best;
}

/**
 * Try a base path with a list of extensions and `/index.<ext>`
 * suffixes; return the first hit in `knownFiles`.
 */
export function tryExtensions(
  basePath: string,
  knownFiles: Set<string>,
  extensions: ReadonlyArray<string> = [
    '',
    '.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs',
    '/index.ts', '/index.tsx', '/index.js', '/index.jsx',
  ],
): string | null {
  for (const ext of extensions) {
    const candidate = basePath + ext;
    if (knownFiles.has(candidate)) return candidate;
  }
  return null;
}

/**
 * Directory listing derived from `knownFiles`, cached per file set.
 *
 * Several languages import a *directory* rather than a file — a Go
 * package, a C# namespace, a Kotlin package, a Swift module target. All
 * of them need the same question answered ("what source files live
 * here?") against the same file set, tens of thousands of times per
 * scan, so the index is built once per (file set, extension) pair and
 * held weakly: it dies with the scan that produced it.
 */
const dirIndexCache = new WeakMap<Set<string>, Map<string, Map<string, string[]>>>();

export function buildDirectoryIndex(
  knownFiles: Set<string>,
  extensions: ReadonlyArray<string>,
): Map<string, string[]> {
  const key = [...extensions].sort().join(',');
  let perSet = dirIndexCache.get(knownFiles);
  if (!perSet) {
    perSet = new Map();
    dirIndexCache.set(knownFiles, perSet);
  }
  const cached = perSet.get(key);
  if (cached) return cached;

  const index = new Map<string, string[]>();
  for (const file of knownFiles) {
    if (!extensions.some((ext) => file.endsWith(ext))) continue;
    const dir = path.dirname(file);
    const bucket = index.get(dir);
    if (bucket) bucket.push(file);
    else index.set(dir, [file]);
  }
  // Deterministic order — the representative file for a directory must
  // not depend on filesystem iteration order.
  for (const bucket of index.values()) bucket.sort();

  perSet.set(key, index);
  return index;
}

export interface RepresentativeFileOptions {
  /** Source extensions this language owns, e.g. `['.cs']`. */
  extensions: ReadonlyArray<string>;
  /**
   * Basename (without extension) to prefer if present — usually the last
   * segment of the import path, which is the dominant naming convention
   * in every language that does this.
   */
  prefer?: string | null;
  /** Files to fall back to only if nothing else matches (tests, mostly). */
  deprioritize?: (filePath: string) => boolean;
}

/**
 * One file to carry the edge for an import that names a directory.
 *
 * The graph model is one edge per import, and these languages import a
 * container. Picking a representative is a deliberate lossy step, not an
 * accident: the alternative is either no edge at all (the coupling
 * disappears from the graph) or an edge per file in the directory (a
 * single import draws a fan of twenty). A named, conventional
 * representative is the readable choice.
 */
export function pickRepresentativeFile(
  dir: string,
  knownFiles: Set<string>,
  options: RepresentativeFileOptions,
): string | null {
  const files = buildDirectoryIndex(knownFiles, options.extensions).get(dir);
  if (!files || files.length === 0) return null;

  if (options.prefer) {
    for (const ext of options.extensions) {
      const candidate = path.join(dir, options.prefer + ext);
      if (files.includes(candidate)) return candidate;
    }
  }

  if (options.deprioritize) {
    const primary = files.find((f) => !options.deprioritize!(f));
    if (primary) return primary;
  }
  return files[0];
}
