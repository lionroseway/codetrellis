import path from 'node:path';
import type { ResolverPlugin, ResolveContext } from './base';
import { tryExtensions } from './base';

/**
 * TypeScript / JavaScript resolver.
 *
 * Resolution order:
 *   1. Relative or absolute paths → file-system relative
 *   2. Workspace alias / tsconfig path → longest-prefix match against
 *      the alias map (which already has both npm package names and
 *      `compilerOptions.paths`)
 *   3. External package (anything else) → skip
 */
function resolve(ctx: ResolveContext): string | null {
  const { importSource, importerPath, knownFiles, aliasMap } = ctx;

  // 1. Relative / absolute
  if (importSource.startsWith('.') || importSource.startsWith('/')) {
    const importerDir = path.dirname(importerPath);
    const basePath = importSource.startsWith('/')
      ? importSource
      : path.resolve(importerDir, importSource);
    return tryExtensions(basePath, knownFiles);
  }

  // 2. Workspace alias / tsconfig path — longest first
  for (const mapping of aliasMap) {
    const { alias, rootPath, entries } = mapping;
    if (importSource === alias) {
      if (entries) {
        for (const e of entries) {
          const candidate = path.resolve(rootPath, e);
          if (knownFiles.has(candidate)) return candidate;
        }
      }
      const indexHit = tryExtensions(path.join(rootPath, 'index'), knownFiles)
        ?? tryExtensions(path.join(rootPath, 'src/index'), knownFiles);
      if (indexHit) return indexHit;
      continue;
    }
    if (importSource.startsWith(alias + '/')) {
      const subpath = importSource.slice(alias.length + 1);
      const basePath = path.resolve(rootPath, subpath);
      const hit = tryExtensions(basePath, knownFiles);
      if (hit) return hit;
    }
  }

  // 3. External package → skip
  return null;
}

export const typescriptResolver: ResolverPlugin = {
  languages: ['typescript', 'javascript'],
  resolve,
};
