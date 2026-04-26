import path from 'node:path';
import type { ResolverPlugin, ResolveContext } from './base';
import { findContainingSystem } from './base';

/**
 * Java resolver — minimum viable.
 *
 * Standard Java + Gradle / Maven layout puts source under
 *   src/main/java/<package>/<Class>.java
 *
 * `import com.example.foo.Bar` becomes
 *   src/main/java/com/example/foo/Bar.java
 *
 * We try a few common source roots within the importer's containing
 * system. Wildcard imports (`com.example.foo.*`) aren't resolved to a
 * single file — skipped here, can be expanded later.
 */

const SOURCE_ROOTS = [
  'src/main/java',
  'src/test/java',
  'src',
  '',
];

const STD_PREFIXES = ['java.', 'javax.', 'sun.', 'com.sun.'];

function resolve(ctx: ResolveContext): string | null {
  const { importSource, importerPath, knownFiles, systems } = ctx;
  if (!importSource) return null;
  if (importSource.endsWith('.*')) return null;
  if (STD_PREFIXES.some((p) => importSource.startsWith(p))) return null;

  const containing = findContainingSystem(importerPath, systems);
  if (!containing) return null;

  const subpath = importSource.replace(/\./g, '/') + '.java';
  for (const root of SOURCE_ROOTS) {
    const candidate = path.join(containing.rootPath, root, subpath);
    if (knownFiles.has(candidate)) return candidate;
  }
  return null;
}

export const javaResolver: ResolverPlugin = {
  languages: ['java'],
  resolve,
};
