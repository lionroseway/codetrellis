/**
 * Per-language import resolver plugin contract.
 *
 * Mirrors the parser plugin shape: one file per language, registered
 * in resolvers/index.ts. Each resolver knows its language's import
 * resolution rules (TS path aliases, Python project-relative,
 * Rust crate-relative, PHP PSR-4, Java package-dir, etc.).
 */

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
